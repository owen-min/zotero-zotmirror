var ZotMirrorPrefs = {
  init(doc) {
    const core = Zotero.ZotMirror;
    if (!core) return;

    const $ = (id) => doc.getElementById(id);

    const sourceInput = $("gds-source-root");
    const targetInput = $("gds-target-root");
    const sourcePreview = $("gds-source-id-preview");
    const targetPreview = $("gds-target-id-preview");
    const includeSub = $("gds-include-sub");
    const flattenSub = $("gds-flatten-sub");
    const removeStale = $("gds-remove-stale");

    const modeGas = $("gds-mode-gas");
    const modeOAuth = $("gds-mode-oauth");
    const panelGas = $("gds-panel-gas");
    const panelOAuth = $("gds-panel-oauth");

    const gasUrl = $("gds-gas-url");
    const gasSecret = $("gds-gas-secret");
    const oauthClientId = $("gds-oauth-client-id");
    const oauthClientSecret = $("gds-oauth-client-secret");
    const oauthRefreshToken = $("gds-oauth-refresh-token");

    const btnOAuthLogin = $("gds-btn-oauth-login");
    const btnTest = $("gds-btn-test");
    const statusSpan = $("gds-test-status");

    function updateIdPreview(inputEl, previewEl) {
      const id = core.parseFolderId(inputEl.value);
      previewEl.textContent = inputEl.value.trim()
        ? (id ? `已识别 Folder ID：${id}` : "未能识别有效的 Folder ID，请粘贴完整链接或 ID")
        : "";
    }

    function updateModePanels() {
      const isGas = modeGas.checked;
      panelGas.style.display = isGas ? "grid" : "none";
      panelOAuth.style.display = isGas ? "none" : "grid";
      core.setPref("mode", isGas ? "gas" : "oauth");
    }

    function updateSubState() {
      flattenSub.disabled = !includeSub.checked;
    }

    // Load initial values
    sourceInput.value = core.getPref("sourceRoot", "");
    targetInput.value = core.getPref("targetRoot", "");
    updateIdPreview(sourceInput, sourcePreview);
    updateIdPreview(targetInput, targetPreview);

    includeSub.checked = !!core.getPref("includeSubcollections", true);
    flattenSub.checked = !!core.getPref("flattenSubcollections", false);
    removeStale.checked = !!core.getPref("removeStale", false);
    updateSubState();

    const savedMode = core.getPref("mode", "gas");
    modeGas.checked = savedMode !== "oauth";
    modeOAuth.checked = savedMode === "oauth";
    updateModePanels();

    gasUrl.value = core.getPref("gasUrl", "");
    gasSecret.value = core.getPref("gasSecret", "");
    oauthClientId.value = core.getPref("oauthClientId", "");
    oauthClientSecret.value = core.getPref("oauthClientSecret", "");
    oauthRefreshToken.value = core.getPref("oauthRefreshToken", "");

    // Bind change handlers
    sourceInput.addEventListener("input", () => {
      core.setPref("sourceRoot", sourceInput.value.trim());
      updateIdPreview(sourceInput, sourcePreview);
    });
    targetInput.addEventListener("input", () => {
      core.setPref("targetRoot", targetInput.value.trim());
      updateIdPreview(targetInput, targetPreview);
    });

    includeSub.addEventListener("command", () => {
      core.setPref("includeSubcollections", includeSub.checked);
      updateSubState();
    });
    flattenSub.addEventListener("command", () => {
      core.setPref("flattenSubcollections", flattenSub.checked);
    });
    removeStale.addEventListener("command", () => {
      core.setPref("removeStale", removeStale.checked);
    });

    modeGas.addEventListener("change", updateModePanels);
    modeOAuth.addEventListener("change", updateModePanels);

    gasUrl.addEventListener("input", () => core.setPref("gasUrl", gasUrl.value.trim()));
    gasSecret.addEventListener("input", () => core.setPref("gasSecret", gasSecret.value.trim()));
    oauthClientId.addEventListener("input", () => core.setPref("oauthClientId", oauthClientId.value.trim()));
    oauthClientSecret.addEventListener("input", () => core.setPref("oauthClientSecret", oauthClientSecret.value.trim()));
    oauthRefreshToken.addEventListener("input", () => core.setPref("oauthRefreshToken", oauthRefreshToken.value.trim()));

    btnOAuthLogin.addEventListener("click", async () => {
      statusSpan.textContent = "正在打开浏览器进行 Google 授权...";
      try {
        const token = await core.startOAuthAuthorization();
        oauthRefreshToken.value = token;
        statusSpan.textContent = "授权成功，Refresh Token 已保存！";
      } catch (err) {
        statusSpan.textContent = "授权失败：" + (err.message || err);
      }
    });

        const btnSyncNow = $("gds-btn-sync-now");
    if (btnSyncNow) {
      btnSyncNow.addEventListener("click", () => {
        core.syncSelectedCollection();
      });
    }

    btnTest.addEventListener("click", async () => {
      statusSpan.textContent = "正在测试连接...";
      try {
        const msg = await core.testConnection();
        statusSpan.textContent = msg.replace(/\n/g, " | ");
      } catch (err) {
        statusSpan.textContent = "连接失败：" + (err.message || err);
      }
    });
  },
};

(function autoInitZotMirrorPrefs() {
  let tries = 0;
  function tryBind() {
    const el = typeof document !== "undefined" && document.getElementById("gds-source-root");
    if (el) {
      if (!el.dataset.gdsBound) {
        el.dataset.gdsBound = "1";
        ZotMirrorPrefs.init(document);
      }
      return;
    }
    if (++tries < 60 && typeof setTimeout === "function") {
      setTimeout(tryBind, 50);
    }
  }
  tryBind();
})();
