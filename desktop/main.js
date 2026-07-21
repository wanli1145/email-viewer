import { access, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, shell } from "electron";
import { startServer } from "../server.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
let serverHandle = null;
let mainWindow = null;

app.commandLine.appendSwitch("use-mock-keychain");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function legacyDbCandidates() {
  const packagedProjectRoot = join(app.getAppPath(), "..", "..", "..", "..", "..", "..");
  return [
    join(projectRoot, "data", "oauth_imap_credentials.sqlite3"),
    join(process.cwd(), "data", "oauth_imap_credentials.sqlite3"),
    join(packagedProjectRoot, "data", "oauth_imap_credentials.sqlite3"),
  ];
}

async function prepareDatabase() {
  const userDataDir = app.getPath("userData");
  const dbFile = join(userDataDir, "oauth_imap_credentials.sqlite3");
  await mkdir(userDataDir, { recursive: true });
  if (await exists(dbFile)) return dbFile;
  for (const legacyDbFile of legacyDbCandidates()) {
    if (await exists(legacyDbFile)) {
      await copyFile(legacyDbFile, dbFile);
      break;
    }
  }
  return dbFile;
}

async function createMainWindow() {
  const dbFile = await prepareDatabase();
  serverHandle = await startServer({
    host: "127.0.0.1",
    port: 0,
    dbFile,
    publicDir: join(projectRoot, "public"),
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    title: "邮箱聚合平台",
    icon: join(projectRoot, "build", "icon.png"),
    backgroundColor: "#edf3fb",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadURL(serverHandle.url);
}

app.whenReady().then(createMainWindow).catch((error) => {
  console.error(error.stack || error.message || error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error) => {
      console.error(error.stack || error.message || error);
      app.quit();
    });
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async () => {
  if (!serverHandle) return;
  const handle = serverHandle;
  serverHandle = null;
  await handle.close().catch((error) => {
    console.error(error.stack || error.message || error);
  });
});
