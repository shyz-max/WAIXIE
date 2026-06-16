import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(rootDir, "data");
const dataFile = path.join(dataDir, "outsourcing-data.json");
const port = Number(process.env.PORT || process.argv[2] || 8765);
const host = process.env.HOST || "0.0.0.0";

const defaultEnvelope = {
  meta: {
    appName: "外协管理工具",
    appVersion: "0.5.0",
    schemaVersion: 1,
    storage: "local-json-file",
    savedAt: new Date().toISOString(),
  },
  data: {
    plans: [],
    prices: [],
    progress: [],
    contracts: [],
    negotiations: [],
    pricingProcesses: [],
    accounts: [],
  },
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
};

async function ensureDataFile() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, `${JSON.stringify(defaultEnvelope, null, 2)}\n`, "utf8");
  }
}

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleApi(req, res) {
  await ensureDataFile();

  if (req.method === "GET" && req.url === "/api/data") {
    const data = await fs.readFile(dataFile, "utf8");
    send(res, 200, data, "application/json; charset=utf-8");
    return true;
  }

  if (req.method === "PUT" && req.url === "/api/data") {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body);
    parsed.meta = {
      ...(parsed.meta || {}),
      storage: "local-json-file",
      savedAt: new Date().toISOString(),
    };
    await fs.writeFile(dataFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    return true;
  }

  return false;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const fullPath = path.normalize(path.join(rootDir, requestedPath));

  if (!fullPath.startsWith(rootDir)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    send(res, 200, body, contentTypes[ext] || "application/octet-stream");
  } catch {
    send(res, 404, "Not Found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (await handleApi(req, res)) return;
    await serveStatic(req, res);
  } catch (error) {
    send(res, 500, `Server Error: ${error.message}`);
  }
});

await ensureDataFile();
server.listen(port, host, () => {
  const lanAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}`);

  console.log(`外协管理工具已启动：http://127.0.0.1:${port}`);
  if (lanAddresses.length > 0) {
    console.log("局域网访问地址：");
    lanAddresses.forEach((address) => console.log(`  ${address}`));
  }
  console.log(`数据文件：${dataFile}`);
});
