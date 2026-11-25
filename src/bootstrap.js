var gPluginID = null;
var gRootURI = null;
var gMenuRegID = null;
var gPrefPaneID = null;
var gInjectedWindows = new Set();

const MENU_ITEM_ID = "zotmirror-sync-collection";
const MENU_SEP_ID = "zotmirror-sync-sep";
const FTL_FILE = "zotmirror.ftl";

function install() {}
function uninstall() {}

function attachFTL(win) {
  try {
    if (win && win.MozXULElement && typeof win.MozXULElement.insertFTLIfNeeded === "function") {
      win.MozXULElement.insertFTLIfNeeded(FTL_FILE);
    }
  } catch (e) {
    Zotero.debug("ZotMirror attachFTL error: " + e);
  }
}

function detachFTL(win) {
  try {
    if (win && win.document) {
      const link = win.document.querySelector(`[href="${FTL_FILE}"]`);
      if (link) link.remove();
    }
  } catch (_) {}
}

async function startup({ id, version, rootURI }) {
  gPluginID = id;
  gRootURI = rootURI;

  Services.scriptloader.loadSubScript(rootURI + "content/sync.js", globalThis);
  Zotero.ZotMirror = ZotMirrorCore;

  // Attach Fluent localization to all currently open main windows
  for (const win of Zotero.getMainWindows()) {
    attachFTL(win);
  }

  // Register Preferences Pane (Zotero 7-10)
  if (Zotero.PreferencePanes && typeof Zotero.PreferencePanes.register === "function") {
    gPrefPaneID = await Zotero.PreferencePanes.register({
      pluginID: id,
      src: "content/prefs.xhtml",
      scripts: ["content/prefs.js"],
      label: "ZotMirror",
      image: "icons/icon-48.png",
    });
  }

  // Register Collection context menu via Zotero 8-10 MenuManager (with l10nID)
  if (Zotero.MenuManager && typeof Zotero.MenuManager.registerMenu === "function") {
    try {
      gMenuRegID = Zotero.MenuManager.registerMenu({
        menuID: `${id}-collection-sync`,
        pluginID: id,
        target: "main/library/collection",
        menus: [
          {
            menuType: "menuitem",
            l10nID: "zotmirror-sync-collection",
            icon: "icons/icon-48.png",
            onShowing: (_event, context) => {
              try {
                const pane = Zotero.getActiveZoteroPane();
                if (context && typeof context.setVisible === "function") {
                  context.setVisible(!!(pane && pane.getSelectedCollection()));
                }
              } catch (_) {}
            },
            onCommand: () => {
              Zotero.ZotMirror.syncSelectedCollection();
            },
          },
        ],
      });
    } catch (e) {
      Zotero.debug("ZotMirror MenuManager fallback: " + e);
      gMenuRegID = null;
    }
  }

  // Fallback for Zotero 7 (or if MenuManager did not register)
  if (!gMenuRegID) {
    for (const win of Zotero.getMainWindows()) {
      injectMenuIntoWindow(win);
    }
  }
}

function injectMenuIntoWindow(win) {
  if (!win || !win.document) return;
  const doc = win.document;
  const menu = doc.getElementById("zotero-collectionmenu");
  if (!menu || doc.getElementById(MENU_ITEM_ID)) return;

  const sep = doc.createXULElement("menuseparator");
  sep.id = MENU_SEP_ID;
  const item = doc.createXULElement("menuitem");
  item.id = MENU_ITEM_ID;
  item.setAttribute("data-l10n-id", "zotmirror-sync-collection");
  item.setAttribute("label", "ZotMirror：同步快捷方式到 Google Drive");
  item.addEventListener("command", () => {
    Zotero.ZotMirror.syncSelectedCollection();
  });

  menu.appendChild(sep);
  menu.appendChild(item);
  gInjectedWindows.add(win);
}

function removeMenuFromWindow(win) {
  if (!win || !win.document) return;
  const doc = win.document;
  const item = doc.getElementById(MENU_ITEM_ID);
  if (item) item.remove();
  const sep = doc.getElementById(MENU_SEP_ID);
  if (sep) sep.remove();
  gInjectedWindows.delete(win);
}

function onMainWindowLoad({ window }) {
  attachFTL(window);
  if (!gMenuRegID) {
    injectMenuIntoWindow(window);
  }
}

function onMainWindowUnload({ window }) {
  removeMenuFromWindow(window);
  detachFTL(window);
}

function shutdown() {
  if (gMenuRegID && Zotero.MenuManager && typeof Zotero.MenuManager.unregisterMenu === "function") {
    try {
      Zotero.MenuManager.unregisterMenu(gMenuRegID);
    } catch (_) {}
    gMenuRegID = null;
  }
  for (const win of Array.from(gInjectedWindows)) {
    removeMenuFromWindow(win);
  }
  for (const win of Zotero.getMainWindows()) {
    detachFTL(win);
  }
  if (gPrefPaneID && Zotero.PreferencePanes && typeof Zotero.PreferencePanes.unregister === "function") {
    try {
      Zotero.PreferencePanes.unregister(gPrefPaneID);
    } catch (_) {}
    gPrefPaneID = null;
  }
  delete Zotero.ZotMirror;
}
