import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const syncCode = fs.readFileSync(path.join(__dirname, "..", "src", "content", "sync.js"), "utf8");

const prefs = {};
const Zotero = {
  Prefs: {
    get: (k) => prefs[k],
    set: (k, v) => { prefs[k] = v; },
  },
  Items: {
    getAsync: async (ids) =>
      ids.map((id) => ({
        isPDFAttachment: () => true,
        getFilePathAsync: async () => id,
      })),
  },
};

const ctx = vm.createContext({ Zotero, URL, URLSearchParams, console, Map, Set });
vm.runInContext(syncCode, ctx);
const core = ctx.ZotMirrorCore;

// 1. Folder ID extraction
assert.strictEqual(
  core.parseFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt?usp=sharing"),
  "1AbCdEfGhIjKlMnOpQrSt"
);
assert.strictEqual(
  core.parseFolderId("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrSt"),
  "1AbCdEfGhIjKlMnOpQrSt"
);
assert.strictEqual(
  core.parseFolderId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrSt"),
  "1AbCdEfGhIjKlMnOpQrSt"
);
assert.strictEqual(core.parseFolderId("1AbCdEfGhIjKlMnOpQrSt"), "1AbCdEfGhIjKlMnOpQrSt");
assert.strictEqual(core.parseFolderId("invalid"), "");

// 2. Strict <authorFolder>/<fileName>.pdf extraction
assert.strictEqual(
  JSON.stringify(core.extractAuthorAndFilename("G:\\Shared drives\\Library\\AUTH\\Smith\\2020_Smith_Enzyme.pdf")),
  JSON.stringify({ authorFolder: "Smith", fileName: "2020_Smith_Enzyme.pdf" })
);
assert.strictEqual(
  JSON.stringify(core.extractAuthorAndFilename("attachments:Wang/2024_Wang_Test.pdf")),
  JSON.stringify({ authorFolder: "Wang", fileName: "2024_Wang_Test.pdf" })
);
assert.strictEqual(core.extractAuthorAndFilename("2020_Smith_RootOnly.pdf"), null);
assert.strictEqual(core.extractAuthorAndFilename("G:\\AUTH\\Smith\\notes.txt"), null);

// 3. Collection planning (nested / flat / root-only)
const fakeSub = {
  name: "Sub1",
  getChildItems: () => [{ isRegularItem: () => true, getAttachments: () => ["G:\\AUTH\\Wang\\2024_Wang.pdf"] }],
  getChildCollections: () => [],
};
const fakeRoot = {
  name: "ProjectA",
  getChildItems: () => [{ isRegularItem: () => true, getAttachments: () => ["G:\\AUTH\\Smith\\2020_Smith.pdf"] }],
  getChildCollections: () => [fakeSub],
};

const nested = await core.buildCollectionPlan(fakeRoot, { includeSubcollections: true, flattenSubcollections: false });
assert.strictEqual(nested.length, 2);
assert.strictEqual(JSON.stringify(nested[0].folderPath), JSON.stringify(["ProjectA"]));
assert.strictEqual(JSON.stringify(nested[1].folderPath), JSON.stringify(["ProjectA", "Sub1"]));

const flat = await core.buildCollectionPlan(fakeRoot, { includeSubcollections: true, flattenSubcollections: true });
assert.strictEqual(flat.length, 1);
assert.strictEqual(JSON.stringify(flat[0].folderPath), JSON.stringify(["ProjectA"]));
assert.strictEqual(flat[0].files.length, 2);

const rootOnly = await core.buildCollectionPlan(fakeRoot, { includeSubcollections: false, flattenSubcollections: false });
assert.strictEqual(rootOnly.length, 1);
assert.strictEqual(rootOnly[0].files.length, 1);

console.log("All tests passed!");
