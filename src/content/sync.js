var ZotMirrorCore = (function () {
  const PREF_PREFIX = "extensions.zotmirror.";
  const LEGACY_PREF_PREFIX = "extensions.gdriveshortcuts.";
  const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
  const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const OAUTH_SCOPE = "https://www.googleapis.com/auth/drive";

  function getPref(key, fallback) {
    try {
      const val = Zotero.Prefs.get(PREF_PREFIX + key, true);
      if (val !== undefined && val !== "") return val;
      const legacy = Zotero.Prefs.get(LEGACY_PREF_PREFIX + key, true);
      if (legacy !== undefined && legacy !== "") return legacy;
      return val === undefined ? fallback : val;
    } catch (e) {
      return fallback;
    }
  }

  function setPref(key, val) {
    Zotero.Prefs.set(PREF_PREFIX + key, val, true);
  }

  /**
   * Extract Google Drive Folder ID from a full URL or raw ID.
   * Supports:
   * - https://drive.google.com/drive/folders/<ID>?usp=sharing
   * - https://drive.google.com/drive/u/0/folders/<ID>
   * - https://drive.google.com/open?id=<ID>
   * - Raw folder ID: 1AbCdEfGhIjKlMnOpQrStUvWxYz
   */
  function parseFolderId(input) {
    if (!input) return "";
    const trimmed = String(input).trim();
    if (!trimmed) return "";

    const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
    if (folderMatch) return folderMatch[1];

    const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (idParamMatch) return idParamMatch[1];

    if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
      return trimmed;
    }
    return "";
  }

  /**
   * Strictly extract the last two path segments: <authorFolder>/<fileName>
   * No fallback search in root (per user requirement).
   */
  function extractAuthorAndFilename(filePath) {
    if (!filePath || typeof filePath !== "string") return null;
    const normalized = filePath.replace(/\\/g, "/").replace(/^attachments:/i, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const fileName = parts[parts.length - 1];
    const authorFolder = parts[parts.length - 2];
    if (!fileName.toLowerCase().endsWith(".pdf")) return null;
    return { authorFolder, fileName };
  }

  /**
   * Build sync tasks from a Zotero Collection.
   * @param {Object} collection - Zotero.Collection
   * @param {Object} options - { includeSubcollections, flattenSubcollections }
   */
  async function buildCollectionPlan(collection, options) {
    const includeSub = !!options.includeSubcollections;
    const flattenSub = !!options.flattenSubcollections;

    async function getFilesForCollection(col) {
      const items = col.getChildItems(false, false);
      const files = [];
      const seen = new Set();

      for (const item of items) {
        if (!item.isRegularItem()) continue;
        const attachmentIDs = item.getAttachments();
        if (!attachmentIDs || !attachmentIDs.length) continue;
        const attachments = await Zotero.Items.getAsync(attachmentIDs);
        for (const att of attachments) {
          const isPdf =
            (typeof att.isPDFAttachment === "function" && att.isPDFAttachment()) ||
            att.attachmentContentType === "application/pdf";
          if (!isPdf) continue;

          let path = null;
          if (typeof att.getFilePathAsync === "function") {
            path = await att.getFilePathAsync();
          }
          if (!path && att.attachmentPath) {
            path = att.attachmentPath;
          }
          const parsed = extractAuthorAndFilename(path);
          if (!parsed) continue;
          const key = parsed.authorFolder + "/" + parsed.fileName;
          if (!seen.has(key)) {
            seen.add(key);
            files.push(parsed);
          }
        }
      }
      return files;
    }

    if (!includeSub) {
      return [
        {
          folderPath: [collection.name],
          files: await getFilesForCollection(collection),
        },
      ];
    }

    if (flattenSub) {
      const merged = [];
      const seen = new Set();
      async function walkFlat(col) {
        const list = await getFilesForCollection(col);
        for (const f of list) {
          const key = f.authorFolder + "/" + f.fileName;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(f);
          }
        }
        const subs = col.getChildCollections(false, false);
        for (const sub of subs) {
          await walkFlat(sub);
        }
      }
      await walkFlat(collection);
      return [{ folderPath: [collection.name], files: merged }];
    }

    // Nested structure preserving subcollection hierarchy
    const tasks = [];
    async function walkNested(col, prefixPath) {
      const currentPath = prefixPath.concat([col.name]);
      tasks.push({
        folderPath: currentPath,
        files: await getFilesForCollection(col),
      });
      const subs = col.getChildCollections(false, false);
      for (const sub of subs) {
        await walkNested(sub, currentPath);
      }
    }
    await walkNested(collection, []);
    return tasks;
  }

  function escapeDriveQuery(str) {
    return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  // =========================================================================
  // Mode A: Google Apps Script Web App Client
  // =========================================================================
  async function callGasBackend(payload) {
    const gasUrl = String(getPref("gasUrl", "")).trim();
    const gasSecret = String(getPref("gasSecret", "")).trim();
    if (!gasUrl) {
      throw new Error("未配置 Google Apps Script Web App URL，请在设置中填写。");
    }
    const bodyObj = Object.assign({ secret: gasSecret }, payload);
    const xhr = await Zotero.HTTP.request("POST", gasUrl, {
      body: JSON.stringify(bodyObj),
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      followRedirects: true,
      successCodes: false,
      timeout: 360000,
    });
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(`GAS 请求失败 (HTTP ${xhr.status}): ${(xhr.responseText || "").slice(0, 200)}`);
    }
    let data;
    try {
      data = JSON.parse(xhr.responseText);
    } catch (e) {
      throw new Error("GAS 返回非 JSON 内容（请确认 Web App 部署权限设为“任何人”且 URL 正确）。");
    }
    if (!data.ok) {
      throw new Error(data.error || "GAS 执行返回未知错误");
    }
    return data;
  }

  // =========================================================================
  // Mode B: Direct Google Drive REST API v3 (OAuth 2.0)
  // =========================================================================
  async function getOAuthAccessToken() {
    const clientId = String(getPref("oauthClientId", "")).trim();
    const clientSecret = String(getPref("oauthClientSecret", "")).trim();
    const refreshToken = String(getPref("oauthRefreshToken", "")).trim();
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("OAuth 2.0 凭据不完整，请在设置中填写 Client ID / Client Secret 并完成授权登录。");
    }
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const xhr = await Zotero.HTTP.request("POST", "https://oauth2.googleapis.com/token", {
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      successCodes: false,
    });
    const data = JSON.parse(xhr.responseText || "{}");
    if (xhr.status !== 200 || !data.access_token) {
      throw new Error(`刷新 Access Token 失败: ${data.error_description || data.error || xhr.status}`);
    }
    return data.access_token;
  }

  async function driveApiRequest(accessToken, method, path, queryParams, jsonBody) {
    let url = DRIVE_API_BASE + path;
    if (queryParams) {
      const qs = new URLSearchParams(queryParams).toString();
      if (qs) url += "?" + qs;
    }
    const options = {
      headers: {
        Authorization: "Bearer " + accessToken,
      },
      successCodes: false,
    };
    if (jsonBody !== undefined) {
      options.headers["Content-Type"] = "application/json;charset=utf-8";
      options.body = JSON.stringify(jsonBody);
    }
    const xhr = await Zotero.HTTP.request(method, url, options);
    const data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
    if (xhr.status < 200 || xhr.status >= 300) {
      const msg = (data.error && data.error.message) || xhr.responseText || ("HTTP " + xhr.status);
      throw new Error(`Drive API 错误 (${xhr.status}): ${msg}`);
    }
    return data;
  }

  async function driveListAll(accessToken, q, fields) {
    const items = [];
    let pageToken = "";
    do {
      const params = {
        q,
        fields: `nextPageToken, files(${fields})`,
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      };
      if (pageToken) params.pageToken = pageToken;
      const res = await driveApiRequest(accessToken, "GET", "/files", params);
      if (res.files && res.files.length) {
        items.push(...res.files);
      }
      pageToken = res.nextPageToken || "";
    } while (pageToken);
    return items;
  }

  async function syncDirectOAuth(sourceRootId, targetRootId, removeStale, tasks) {
    const accessToken = await getOAuthAccessToken();

    // Verify both folders are reachable
    await driveApiRequest(accessToken, "GET", "/files/" + encodeURIComponent(sourceRootId), {
      fields: "id, name, mimeType",
      supportsAllDrives: "true",
    });
    await driveApiRequest(accessToken, "GET", "/files/" + encodeURIComponent(targetRootId), {
      fields: "id, name, mimeType",
      supportsAllDrives: "true",
    });

    const authorFolderCache = new Map();
    const authorFilesCache = new Map();

    async function findSourcePdfId(authorFolder, fileName) {
      if (!authorFolderCache.has(authorFolder)) {
        const qFolder = `'${escapeDriveQuery(sourceRootId)}' in parents and name = '${escapeDriveQuery(authorFolder)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
        const found = await driveListAll(accessToken, qFolder, "id, name");
        authorFolderCache.set(authorFolder, found.length ? found[0].id : null);
      }
      const authorFolderId = authorFolderCache.get(authorFolder);
      if (!authorFolderId) return null;

      if (!authorFilesCache.has(authorFolderId)) {
        const qFiles = `'${escapeDriveQuery(authorFolderId)}' in parents and trashed = false`;
        const files = await driveListAll(accessToken, qFiles, "id, name, mimeType");
        const map = new Map();
        for (const f of files) {
          map.set(f.name, f.id);
        }
        authorFilesCache.set(authorFolderId, map);
      }
      return authorFilesCache.get(authorFolderId).get(fileName) || null;
    }

    async function ensureFolderPath(parentId, folderSegments) {
      let currentId = parentId;
      for (const seg of folderSegments) {
        const q = `'${escapeDriveQuery(currentId)}' in parents and name = '${escapeDriveQuery(seg)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
        const found = await driveListAll(accessToken, q, "id, name");
        if (found.length) {
          currentId = found[0].id;
        } else {
          const created = await driveApiRequest(
            accessToken,
            "POST",
            "/files",
            { supportsAllDrives: "true", fields: "id, name" },
            { name: seg, mimeType: FOLDER_MIME, parents: [currentId] }
          );
          currentId = created.id;
        }
      }
      return currentId;
    }

    const stats = { created: 0, skipped: 0, removed: 0, notFound: [] };

    for (const task of tasks) {
      const destFolderId = await ensureFolderPath(targetRootId, task.folderPath);

      // List existing shortcuts in destFolderId
      const qExisting = `'${escapeDriveQuery(destFolderId)}' in parents and mimeType = '${SHORTCUT_MIME}' and trashed = false`;
      const existing = await driveListAll(accessToken, qExisting, "id, name, shortcutDetails");
      const existingByTarget = new Map();
      for (const sc of existing) {
        const tid = sc.shortcutDetails && sc.shortcutDetails.targetId;
        if (tid) existingByTarget.set(tid, sc.id);
      }

      const desiredTargetIds = new Set();
      for (const fileRef of task.files) {
        const pdfId = await findSourcePdfId(fileRef.authorFolder, fileRef.fileName);
        if (!pdfId) {
          stats.notFound.push(`${fileRef.authorFolder}/${fileRef.fileName}`);
          continue;
        }
        desiredTargetIds.add(pdfId);
        if (existingByTarget.has(pdfId)) {
          stats.skipped++;
          continue;
        }
        await driveApiRequest(
          accessToken,
          "POST",
          "/files",
          { supportsAllDrives: "true", fields: "id" },
          {
            name: fileRef.fileName,
            mimeType: SHORTCUT_MIME,
            parents: [destFolderId],
            shortcutDetails: { targetId: pdfId },
          }
        );
        stats.created++;
      }

      if (removeStale) {
        for (const [tid, shortcutId] of existingByTarget.entries()) {
          if (!desiredTargetIds.has(tid)) {
            await driveApiRequest(
              accessToken,
              "PATCH",
              "/files/" + encodeURIComponent(shortcutId),
              { supportsAllDrives: "true" },
              { trashed: true }
            );
            stats.removed++;
          }
        }
      }
    }

    return { ok: true, stats };
  }

  // =========================================================================
  // Interactive OAuth 2.0 Loopback Flow for Desktop Zotero (Mode B)
  // =========================================================================
  async function startOAuthAuthorization() {
    const clientId = String(getPref("oauthClientId", "")).trim();
    const clientSecret = String(getPref("oauthClientSecret", "")).trim();
    if (!clientId || !clientSecret) {
      throw new Error("请先填写 OAuth Client ID 和 Client Secret。");
    }

    const serverSocket = Components.classes["@mozilla.org/network/server-socket;1"].createInstance(
      Components.interfaces.nsIServerSocket
    );
    serverSocket.init(-1, true, -1); // loopback only, random free port
    const port = serverSocket.port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: OAUTH_SCOPE,
        access_type: "offline",
        prompt: "consent",
      }).toString();

    const timerHost = (typeof setTimeout === "function") ? globalThis : Zotero.getMainWindow();
    const _setTimeout = timerHost.setTimeout.bind(timerHost);
    const _clearTimeout = timerHost.clearTimeout.bind(timerHost);

    const code = await new Promise((resolve, reject) => {
      const timer = _setTimeout(() => {
        try { serverSocket.close(); } catch (_) {}
        reject(new Error("授权超时（180秒内未完成浏览器回调）。"));
      }, 180000);

      serverSocket.asyncListen({
        onSocketAccepted(_serv, transport) {
          try {
            const input = transport.openInputStream(0, 0, 0);
            const scriptInput = Components.classes["@mozilla.org/scriptableinputstream;1"].createInstance(
              Components.interfaces.nsIScriptableInputStream
            );
            scriptInput.init(input);

            let rawReq = "";
            const waitChunk = () => {
              try {
                const avail = scriptInput.available();
                if (avail > 0) {
                  rawReq += scriptInput.read(avail);
                }
              } catch (_) {}
              if (rawReq.includes("\r\n\r\n") || rawReq.length > 4096) {
                const firstLine = rawReq.split("\r\n")[0] || "";
                const m = firstLine.match(/GET\s+([^\s]+)\s+HTTP/i);
                const reqPath = m ? m[1] : "/";
                const parsed = new URL("http://127.0.0.1" + reqPath);
                const authCode = parsed.searchParams.get("code");
                const authErr = parsed.searchParams.get("error");

                const html = authCode
                  ? "<html><body style='font-family:sans-serif;padding:24px'><h2>授权成功</h2><p>可以关闭此页面并返回 Zotero。</p></body></html>"
                  : `<html><body style='font-family:sans-serif;padding:24px'><h2>授权失败</h2><p>${authErr || "未收到授权码"}</p></body></html>`;
                const response =
                  "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n" + html;

                const out = transport.openOutputStream(0, 0, 0);
                out.write(response, response.length);
                out.close();
                scriptInput.close();
                _clearTimeout(timer);
                try { serverSocket.close(); } catch (_) {}

                if (authCode) resolve(authCode);
                else reject(new Error("Google 拒绝授权: " + (authErr || "unknown")));
              } else {
                _setTimeout(waitChunk, 50);
              }
            };
            _setTimeout(waitChunk, 50);
          } catch (err) {
            _clearTimeout(timer);
            try { serverSocket.close(); } catch (_) {}
            reject(err);
          }
        },
        onStopListening() {},
      });

      Zotero.launchURL(authUrl);
    });

    // Exchange authorization code for refresh_token
    const form = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const xhr = await Zotero.HTTP.request("POST", "https://oauth2.googleapis.com/token", {
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      successCodes: false,
    });
    const data = JSON.parse(xhr.responseText || "{}");
    if (xhr.status !== 200 || !data.refresh_token) {
      throw new Error(`换取 Refresh Token 失败: ${data.error_description || data.error || xhr.status}`);
    }
    setPref("oauthRefreshToken", data.refresh_token);
    return data.refresh_token;
  }

  async function testConnection() {
    const mode = getPref("mode", "gas");
    const sourceRootId = parseFolderId(getPref("sourceRoot", ""));
    const targetRootId = parseFolderId(getPref("targetRoot", ""));
    if (!sourceRootId || !targetRootId) {
      throw new Error("请先填写有效的源目录（AUTH）和输出根目录的链接或 Folder ID。");
    }

    if (mode === "gas") {
      const res = await callGasBackend({
        action: "test",
        sourceRootId,
        targetRootId,
      });
      return `GAS 连接成功！\n源目录：${res.sourceName}\n输出根目录：${res.targetName}`;
    } else {
      const token = await getOAuthAccessToken();
      const src = await driveApiRequest(token, "GET", "/files/" + encodeURIComponent(sourceRootId), {
        fields: "id, name",
        supportsAllDrives: "true",
      });
      const dst = await driveApiRequest(token, "GET", "/files/" + encodeURIComponent(targetRootId), {
        fields: "id, name",
        supportsAllDrives: "true",
      });
      return `OAuth 直连成功！\n源目录：${src.name}\n输出根目录：${dst.name}`;
    }
  }

  async function syncSelectedCollection() {
    const pane = Zotero.getActiveZoteroPane();
    const collection = pane && pane.getSelectedCollection();
    if (!collection) {
      Zotero.alert(null, "ZotMirror", "请先在左侧选中一个 Zotero 分类（Collection）。");
      return;
    }

    const mode = getPref("mode", "gas");
    const sourceRootId = parseFolderId(getPref("sourceRoot", ""));
    const targetRootId = parseFolderId(getPref("targetRoot", ""));
    const includeSubcollections = !!getPref("includeSubcollections", true);
    const flattenSubcollections = !!getPref("flattenSubcollections", false);
    const removeStale = !!getPref("removeStale", false);

    if (!sourceRootId || !targetRootId) {
      Zotero.alert(
        null,
        "ZotMirror",
        "请先在 Zotero 设置 → ZotMirror 中填写源目录（AUTH）和输出根目录的链接或 ID。"
      );
      return;
    }

    const pw = new Zotero.ProgressWindow();
    pw.changeHeadline("ZotMirror");
    pw.addDescription(`正在扫描分类「${collection.name}」...`);
    pw.show();

    try {
      const tasks = await buildCollectionPlan(collection, {
        includeSubcollections,
        flattenSubcollections,
      });
      const totalFiles = tasks.reduce((acc, t) => acc + t.files.length, 0);
      if (totalFiles === 0) {
        pw.addDescription("未找到符合 <作者文件夹>/<文件名>.pdf 结构的链接附件。");
        pw.startCloseTimer(5000);
        return;
      }

      pw.addDescription(
        `共 ${tasks.length} 个目录、${totalFiles} 篇 PDF，正在通过 ${mode === "gas" ? "GAS Web App" : "OAuth Drive API"} 同步...`
      );

      let result;
      if (mode === "gas") {
        result = await callGasBackend({
          action: "sync",
          sourceRootId,
          targetRootId,
          removeStale,
          tasks,
        });
      } else {
        result = await syncDirectOAuth(sourceRootId, targetRootId, removeStale, tasks);
      }

      const st = result.stats || { created: 0, skipped: 0, removed: 0, notFound: [] };
      const summary = `完成！新增 ${st.created}，已存在跳过 ${st.skipped}，清理旧链接 ${st.removed}，未匹配 ${st.notFound.length}`;
      pw.addDescription(summary);
      if (st.notFound && st.notFound.length) {
        Zotero.debug("ZotMirror notFound:\n" + st.notFound.join("\n"));
        pw.addDescription("未匹配列表已写入 Debug 日志（前3项：" + st.notFound.slice(0, 3).join(", ") + "）");
      }
      pw.startCloseTimer(8000);
    } catch (err) {
      Zotero.debug("ZotMirror sync error: " + err);
      pw.addDescription("同步失败：" + (err.message || err));
      pw.startCloseTimer(10000);
    }
  }

  return {
    getPref,
    setPref,
    parseFolderId,
    extractAuthorAndFilename,
    buildCollectionPlan,
    startOAuthAuthorization,
    testConnection,
    syncSelectedCollection,
  };
})();
