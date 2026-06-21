var http = require("http");
var fs = require("fs");
var os = require("os");
var path = require("path");

var rootDir = __dirname;
var dataDir = path.join(rootDir, "data");
var dataFile = path.join(dataDir, "outsourcing-data.json");
var attachmentDir = path.join(rootDir, "attachments");
var port = Number(process.env.PORT || process.argv[2] || 8765);
var host = process.env.HOST || "0.0.0.0";

var defaultEnvelope = {
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
    procedures: [],
  },
};

var contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".pdf": "application/pdf",
};

function safeName(value, fallback) {
  return String(value || fallback || "file")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function ensureDataFile(callback) {
  fs.mkdir(dataDir, { recursive: true }, function (mkdirError) {
    if (mkdirError) return callback(mkdirError);
    fs.access(dataFile, fs.constants.F_OK, function (accessError) {
      if (!accessError) return callback();
      fs.writeFile(dataFile, JSON.stringify(defaultEnvelope, null, 2) + "\n", "utf8", callback);
    });
  });
}

function send(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType || "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readRequestBody(req, callback) {
  var chunks = [];
  req.on("data", function (chunk) {
    chunks.push(chunk);
  });
  req.on("end", function () {
    callback(null, Buffer.concat(chunks).toString("utf8"));
  });
  req.on("error", callback);
}

function handleApi(req, res, callback) {
  ensureDataFile(function (ensureError) {
    if (ensureError) return callback(ensureError);

    if (req.method === "OPTIONS") {
      send(res, 204, "");
      callback(null, true);
      return;
    }

    if (req.method === "GET" && req.url === "/api/data") {
      fs.readFile(dataFile, "utf8", function (readError, data) {
        if (readError) return callback(readError);
        send(res, 200, data, "application/json; charset=utf-8");
        callback(null, true);
      });
      return;
    }

    if (req.method === "PUT" && req.url === "/api/data") {
      readRequestBody(req, function (bodyError, body) {
        if (bodyError) return callback(bodyError);
        var parsed = JSON.parse(body);
        parsed.meta = Object.assign({}, parsed.meta || {}, {
          storage: "local-json-file",
          savedAt: new Date().toISOString(),
        });
        fs.writeFile(dataFile, JSON.stringify(parsed, null, 2) + "\n", "utf8", function (writeError) {
          if (writeError) return callback(writeError);
          send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
          callback(null, true);
        });
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/attachments/procedure") {
      readRequestBody(req, function (bodyError, body) {
        if (bodyError) return callback(bodyError);
        var parsed = JSON.parse(body);
        var originalName = safeName(parsed.fileName || "procedure.pdf");
        if (path.extname(originalName).toLowerCase() !== ".pdf") {
          originalName += ".pdf";
        }
        var taskDirName = safeName(parsed.taskNo || "未编号");
        var targetDir = path.join(attachmentDir, "procedure", taskDirName);
        var fileName = Date.now() + "-" + originalName;
        var targetFile = path.join(targetDir, fileName);
        fs.mkdir(targetDir, { recursive: true }, function (mkdirError) {
          if (mkdirError) return callback(mkdirError);
          fs.writeFile(targetFile, Buffer.from(parsed.data || "", "base64"), function (writeError) {
            if (writeError) return callback(writeError);
            var urlPath =
              "/attachments/procedure/" + encodeURIComponent(taskDirName) + "/" + encodeURIComponent(fileName);
            send(
              res,
              200,
              JSON.stringify({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2),
                name: parsed.fileName || originalName,
                path: urlPath,
                url: urlPath,
                size: Number(parsed.size || 0),
                uploadedAt: new Date().toISOString(),
              }),
              "application/json; charset=utf-8",
            );
            callback(null, true);
          });
        });
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/attachments/vendor") {
      readRequestBody(req, function (bodyError, body) {
        if (bodyError) return callback(bodyError);
        var parsed = JSON.parse(body);
        var originalName = safeName(parsed.fileName || "file.pdf");
        if (path.extname(originalName).toLowerCase() !== ".pdf") originalName += ".pdf";
        var targetDir = path.join(attachmentDir, "vendor", parsed.type || "other");
        var fileName = Date.now() + "-" + originalName;
        var targetFile = path.join(targetDir, fileName);
        fs.mkdir(targetDir, { recursive: true }, function (mkdirError) {
          if (mkdirError) return callback(mkdirError);
          fs.writeFile(targetFile, Buffer.from(parsed.data || "", "base64"), function (writeError) {
            if (writeError) return callback(writeError);
            var urlPath = "/attachments/vendor/" + (parsed.type || "other") + "/" + encodeURIComponent(fileName);
            send(res, 200, JSON.stringify({ url: urlPath, path: urlPath, fileName: parsed.fileName, size: parsed.size }), "application/json; charset=utf-8");
            callback(null, true);
          });
        });
      });
      return;
    }

    callback(null, false);
  });
}

function serveStatic(req, res) {
  var parsedUrl = new URL(req.url, "http://localhost:" + port);
  var requestedPath = decodeURIComponent(parsedUrl.pathname === "/" ? "/index.html" : parsedUrl.pathname);
  var fullPath = path.normalize(path.join(rootDir, requestedPath));

  if (fullPath.indexOf(rootDir) !== 0) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(fullPath, function (readError, body) {
    if (readError) {
      send(res, 404, "Not Found");
      return;
    }
    var ext = path.extname(fullPath).toLowerCase();
    send(res, 200, body, contentTypes[ext] || "application/octet-stream");
  });
}

var server = http.createServer(function (req, res) {
  handleApi(req, res, function (error, handled) {
    if (error) {
      send(res, 500, "Server Error: " + error.message);
      return;
    }
    if (!handled) serveStatic(req, res);
  });
});

ensureDataFile(function (error) {
  if (error) {
    console.error("数据文件初始化失败：" + error.message);
    process.exit(1);
  }

  server.listen(port, host, function () {
    var interfaces = os.networkInterfaces();
    var lanAddresses = [];

    Object.keys(interfaces).forEach(function (name) {
      interfaces[name].forEach(function (item) {
        if (item && item.family === "IPv4" && !item.internal) {
          lanAddresses.push("http://" + item.address + ":" + port);
        }
      });
    });

    console.log("外协管理工具已启动：http://127.0.0.1:" + port);
    if (lanAddresses.length > 0) {
      console.log("局域网访问地址：");
      lanAddresses.forEach(function (address) {
        console.log("  " + address);
      });
    }
    console.log("数据文件：" + dataFile);
  });
});
