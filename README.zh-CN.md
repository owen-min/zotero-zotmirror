# ZotMirror (`zotero-zotmirror`)

[English README](README.md)

一个面向 **Zotero 7–10** 的插件：在不改变底层 `AUTH/<作者>/<文件名>.pdf` 存储结构、且不占用双倍网盘空间的前提下，按 Zotero 分类（Collection）在 Google Drive 中自动生成对应 PDF 的**快捷方式（Google Drive Shortcut）**，方便直接导入 **Gemini** 或 **NotebookLM（Gemini Notebook）** 按课题批量分析文献。

---

## 核心特性

- **适配 Zotero 7–10**：原生 Bootstrap 架构，兼容 Zotero 8–10 的 `Zotero.MenuManager`（带 Fluent 中/英文本地化）并在 Zotero 7 自动回退 DOM 注入。
- **零重复存储**：在目标目录中创建 `application/vnd.google-apps.shortcut` 指向原始 PDF，不复制文件、不占双倍 Google Drive 空间。
- **支持“与我共享（Shared with me）”与共享云端硬盘**：所有 Drive API 请求均启用 `supportsAllDrives=true&includeItemsFromAllDrives=true`。
- **严格两级路径匹配**：从每个 PDF 附件路径提取最后两级 `<作者文件夹>/<文件名>.pdf`，精准匹配源目录（如 `sharedwithme/Library/AUTH`）下的原文件。
- **灵活的同步开关**：
  - 是否包含子分类（Include subcollections）
  - 子分类平铺合并到单个文件夹 / 保留嵌套文件夹层级
  - 严格镜像（将已移出分类的旧快捷方式移入回收站，安全可恢复）
- **双连接路线可选**：
  - **路线 A**：个人 Google Apps Script (GAS) Web App（部署 1 分钟，免配置 Google Cloud OAuth）
  - **路线 B**：Google Drive REST API v3 直连（OAuth 2.0 桌面端回环授权，无公网端点）

---

## 目录结构

```text
zotero-zotmirror/
├── src/                        # Zotero 插件源码
│   ├── manifest.json           # Zotero 7-10 清单（含必填 update_url 与双声明）
│   ├── bootstrap.js            # 插件生命周期、设置面板与右键菜单注册
│   ├── prefs.js                # 默认偏好设置
│   ├── content/
│   │   ├── sync.js             # 核心引擎（路径解析、Collection 规划、GAS/OAuth2 同步）
│   │   ├── prefs.xhtml         # 设置面板 UI
│   │   └── prefs.js            # 设置面板逻辑与 DOM 自动绑定
│   ├── locale/
│   │   ├── zh-CN/zotmirror.ftl
│   │   └── en-US/zotmirror.ftl
│   └── icons/
│       ├── icon-48.png
│       └── icon-96.png
├── gas/                        # 路线 A 配套 Google Apps Script 后端
│   ├── Code.gs                 # Web App 源码（含写入权限声明与可选目录白名单锁）
│   └── appsscript.json         # GAS 清单（显式声明 Drive 读写权限）
├── scripts/
│   └── build_xpi.py            # 零依赖打包脚本
├── tests/
│   └── sync.test.mjs           # 核心逻辑单元测试
├── build/
│   └── zotmirror-1.0.0.xpi  # 预编译安装包
├── package.json
├── LICENSE
└── README.md
```

---

## 安装

1. 下载或使用 `build/zotmirror-1.0.0.xpi`（建议先复制到本地磁盘目录）。
2. 在 Zotero 7–10 中打开 **工具 → 插件（Plugins）→ 右上角齿轮 → Install Plugin From File…**，选择 `.xpi` 文件安装。
3. 打开 **编辑 → 设置 → ZotMirror** 完成配置。

---

## 配置说明

### 1. 获取 Google Drive 文件夹链接 / ID
在浏览器打开 Google Drive 网页版，进入目标文件夹后直接复制浏览器地址栏链接（形如 `https://drive.google.com/drive/folders/1AbCdEf...`），粘贴到插件设置中的 **源目录（AUTH）** 和 **输出根目录**（例如 `Zotero_By_Collection`）即可，插件会自动提取 `/folders/` 后的 Folder ID 并实时预览。

### 2. 路线 A：Google Apps Script Web App（推荐）
1. 打开 [script.google.com](https://script.google.com/) 新建项目，将 `gas/Code.gs` 全部粘贴进去。
2. 修改顶部的 `SECRET_TOKEN` 为你自己的 32 位以上随机口令；**强烈建议**同时填写 `ALLOWED_SOURCE_ROOT_ID` 和 `ALLOWED_TARGET_ROOT_ID` 锁定允许操作的目录白名单。
3. 保存后，在编辑器顶部下拉框选择 `_ensureDriveScope_` 点击一次 **运行（Run）**，完成弹出的 Google Drive 读写权限授权。
4. 点击右上角 **部署 → 新建部署 → Web 应用**：
   - 执行身份：**我（Me）**
   - 谁可以访问：**任何人（Anyone）**（请求受 `SECRET_TOKEN` 与目录白名单保护）
5. 复制生成的 `/exec` 链接和 `SECRET_TOKEN` 填入 Zotero 插件设置，点击 **测试连接**。

> 注意：后续每次修改 `Code.gs` 后，需点击 **部署 → 管理部署 → 编辑 → 版本选「新版本」→ 部署** 才会生效（URL 保持不变）。

### 3. 路线 B：Google Drive REST API v3 直连（OAuth 2.0）
1. 在 Google Cloud Console 启用 **Google Drive API**。
2. 在 **OAuth consent screen** 中将应用保持为 **Testing（测试模式）**，并把自己的 Google 账号加入 Test Users。
3. 在 **Credentials** 中创建 **Desktop app（桌面应用）** 类型的 OAuth Client ID。
4. 在 Zotero 插件设置切换到 **路线 B**，填入 `Client ID` 和 `Client Secret`，点击 **浏览器授权登录**（插件自动拉起 `127.0.0.1` 临时回调并保存 `Refresh Token`），最后点击 **测试连接**。

---

## 使用方法

- **右键触发**：在 Zotero 左侧分类栏右键点击任意分类（Collection）→ 选择 **「ZotMirror：同步快捷方式到 Google Drive」**。
- **设置页触发**：也可在 **设置 → ZotMirror** 底部点击 **「立即同步当前选中的分类」**。
- 同步结果（新增、已存在跳过、清理旧链接、未匹配数量）会显示在右下角进度窗；若有未匹配的 PDF，具体 `<作者文件夹>/<文件名>` 列表会写入 **Help → Debug Output Logging**（搜索 `ZotMirror`）。

---

## 本地测试与重新打包

本项目不依赖第三方 npm 包，仅需系统自带的 Node.js 与 Python 3：

```bash
# 运行核心逻辑单元测试
npm test

# 从 src/ 重新打包 .xpi 到 build/
npm run build
```

---

## License

MIT
