/**
 * Google Apps Script Web App backend for ZotMirror (Zotero 7-10 plugin).
 *
 * 部署步骤：
 * 1. 打开 https://script.google.com/ 新建项目，将本文件全部粘贴进去并修改下方 SECRET_TOKEN。
 * 2. 点击右上角「部署」→「新建部署」→ 类型选「Web 应用」。
 *    - 执行身份：我（Me）
 *    - 谁可以访问：任何人（Anyone，请求受下方 SECRET_TOKEN 保护）
 * 3. 复制生成的 Web App URL（以 /exec 结尾）和 SECRET_TOKEN 填入 Zotero 插件设置。
 */

const SECRET_TOKEN = "CHANGE_ME_TO_A_RANDOM_SECRET";

// 可选安全加固：填入允许操作的 Google Drive Folder ID 白名单（留空则不限制）
const ALLOWED_SOURCE_ROOT_ID = "";
const ALLOWED_TARGET_ROOT_ID = "";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// 触发 GAS 自动申请 Google Drive 读写权限（无需手动开启 Advanced Drive Service）
function _ensureDriveScope_() {
  DriveApp.getRootFolder();
  if (false) DriveApp.createFile("scope", "");
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    if (!SECRET_TOKEN || payload.secret !== SECRET_TOKEN) {
      return jsonResponse({ ok: false, error: "Invalid secret token" });
    }
    if (ALLOWED_SOURCE_ROOT_ID && payload.sourceRootId !== ALLOWED_SOURCE_ROOT_ID) {
      return jsonResponse({ ok: false, error: "sourceRootId is not in whitelist" });
    }
    if (ALLOWED_TARGET_ROOT_ID && payload.targetRootId !== ALLOWED_TARGET_ROOT_ID) {
      return jsonResponse({ ok: false, error: "targetRootId is not in whitelist" });
    }

    if (payload.action === "test") {
      const src = driveRequest("GET", "/files/" + encodeURIComponent(payload.sourceRootId), {
        fields: "id, name",
        supportsAllDrives: "true",
      });
      const dst = driveRequest("GET", "/files/" + encodeURIComponent(payload.targetRootId), {
        fields: "id, name",
        supportsAllDrives: "true",
      });
      return jsonResponse({ ok: true, sourceName: src.name, targetName: dst.name });
    }

    if (payload.action === "sync") {
      const stats = runSync(
        payload.sourceRootId,
        payload.targetRootId,
        !!payload.removeStale,
        payload.tasks || []
      );
      return jsonResponse({ ok: true, stats });
    }

    return jsonResponse({ ok: false, error: "Unknown action: " + payload.action });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function escapeQuery(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function driveRequest(method, path, queryParams, jsonBody) {
  let url = DRIVE_API_BASE + path;
  if (queryParams) {
    const parts = [];
    for (const k in queryParams) {
      if (queryParams[k] !== undefined && queryParams[k] !== "") {
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(queryParams[k]));
      }
    }
    if (parts.length) url += "?" + parts.join("&");
  }
  const opts = {
    method: method,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  };
  if (jsonBody !== undefined) {
    opts.contentType = "application/json; charset=utf-8";
    opts.payload = JSON.stringify(jsonBody);
  }
  const resp = UrlFetchApp.fetch(url, opts);
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  const data = text ? JSON.parse(text) : {};
  if (code < 200 || code >= 300) {
    throw new Error("Drive API (" + code + "): " + ((data.error && data.error.message) || text));
  }
  return data;
}

function driveListAll(q, fields) {
  const items = [];
  let pageToken = "";
  do {
    const res = driveRequest("GET", "/files", {
      q: q,
      fields: "nextPageToken, files(" + fields + ")",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      pageToken: pageToken,
    });
    if (res.files && res.files.length) {
      Array.prototype.push.apply(items, res.files);
    }
    pageToken = res.nextPageToken || "";
  } while (pageToken);
  return items;
}

function runSync(sourceRootId, targetRootId, removeStale, tasks) {
  const authorFolderCache = {};
  const authorFilesCache = {};

  function findSourcePdfId(authorFolder, fileName) {
    if (!(authorFolder in authorFolderCache)) {
      const qFolder =
        "'" + escapeQuery(sourceRootId) + "' in parents and name = '" + escapeQuery(authorFolder) +
        "' and mimeType = '" + FOLDER_MIME + "' and trashed = false";
      const found = driveListAll(qFolder, "id, name");
      authorFolderCache[authorFolder] = found.length ? found[0].id : null;
    }
    const authorFolderId = authorFolderCache[authorFolder];
    if (!authorFolderId) return null;

    if (!(authorFolderId in authorFilesCache)) {
      const qFiles = "'" + escapeQuery(authorFolderId) + "' in parents and trashed = false";
      const files = driveListAll(qFiles, "id, name");
      const map = {};
      for (let i = 0; i < files.length; i++) {
        map[files[i].name] = files[i].id;
      }
      authorFilesCache[authorFolderId] = map;
    }
    return authorFilesCache[authorFolderId][fileName] || null;
  }

  function ensureFolderPath(parentId, segments) {
    let currentId = parentId;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const q =
        "'" + escapeQuery(currentId) + "' in parents and name = '" + escapeQuery(seg) +
        "' and mimeType = '" + FOLDER_MIME + "' and trashed = false";
      const found = driveListAll(q, "id, name");
      if (found.length) {
        currentId = found[0].id;
      } else {
        const created = driveRequest(
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

  for (let t = 0; t < tasks.length; t++) {
    const task = tasks[t];
    const destFolderId = ensureFolderPath(targetRootId, task.folderPath);

    const qExisting =
      "'" + escapeQuery(destFolderId) + "' in parents and mimeType = '" + SHORTCUT_MIME + "' and trashed = false";
    const existing = driveListAll(qExisting, "id, name, shortcutDetails");
    const existingByTarget = {};
    for (let i = 0; i < existing.length; i++) {
      const tid = existing[i].shortcutDetails && existing[i].shortcutDetails.targetId;
      if (tid) existingByTarget[tid] = existing[i].id;
    }

    const desiredTargets = {};
    for (let j = 0; j < task.files.length; j++) {
      const f = task.files[j];
      const pdfId = findSourcePdfId(f.authorFolder, f.fileName);
      if (!pdfId) {
        stats.notFound.push(f.authorFolder + "/" + f.fileName);
        continue;
      }
      desiredTargets[pdfId] = true;
      if (existingByTarget[pdfId]) {
        stats.skipped++;
        continue;
      }
      driveRequest(
        "POST",
        "/files",
        { supportsAllDrives: "true", fields: "id" },
        {
          name: f.fileName,
          mimeType: SHORTCUT_MIME,
          parents: [destFolderId],
          shortcutDetails: { targetId: pdfId },
        }
      );
      stats.created++;
    }

    if (removeStale) {
      for (const tid in existingByTarget) {
        if (!desiredTargets[tid]) {
          driveRequest(
            "PATCH",
            "/files/" + encodeURIComponent(existingByTarget[tid]),
            { supportsAllDrives: "true" },
            { trashed: true }
          );
          stats.removed++;
        }
      }
    }
  }

  return stats;
}
