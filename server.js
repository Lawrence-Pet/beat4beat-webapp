const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const currentGamePath = path.join(dataDir, "current-game.json");
const savedGamesPath = path.join(dataDir, "saved-games.json");
const defaultPort = Number(process.env.PORT) || 3000;
const argPortIndex = process.argv.findIndex((arg) => arg === "--port" || arg === "-p");
const requestedPort =
  argPortIndex >= 0 ? Number(process.argv[argPortIndex + 1]) : defaultPort;
const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : defaultPort;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(
    res,
    statusCode,
    { "Content-Type": "application/json; charset=utf-8" },
    JSON.stringify(payload)
  );
}

function safePathFromUrl(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const resolved = normalized === "/" ? "/index.html" : normalized;
  return path.join(rootDir, resolved);
}

function ensureDataFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(currentGamePath)) {
    fs.writeFileSync(currentGamePath, JSON.stringify({ state: null, updatedAt: null }, null, 2));
  }
  if (!fs.existsSync(savedGamesPath)) {
    fs.writeFileSync(savedGamesPath, JSON.stringify({ items: [] }, null, 2));
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function buildGameSummary(item) {
  const state = item.state || {};
  return {
    id: item.id,
    name: item.name,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    teamCount: Array.isArray(state.teams) ? state.teams.length : 0,
    roundCount: Array.isArray(state.rounds) ? state.rounds.length : 0
  };
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/bootstrap" && req.method === "GET") {
    const currentGame = readJson(currentGamePath, { state: null, updatedAt: null });
    const savedGames = readJson(savedGamesPath, { items: [] });
    sendJson(res, 200, {
      currentGame,
      savedGames: savedGames.items.map(buildGameSummary)
    });
    return true;
  }

  if (pathname === "/api/state" && req.method === "GET") {
    sendJson(res, 200, readJson(currentGamePath, { state: null, updatedAt: null }));
    return true;
  }

  if (pathname === "/api/state" && req.method === "PUT") {
    const body = await readBody(req);
    const parsed = JSON.parse(body || "{}");
    const nextState = {
      state: parsed.state ?? null,
      updatedAt: new Date().toISOString()
    };
    writeJson(currentGamePath, nextState);
    sendJson(res, 200, nextState);
    return true;
  }

  if (pathname === "/api/games" && req.method === "GET") {
    const savedGames = readJson(savedGamesPath, { items: [] });
    sendJson(res, 200, { items: savedGames.items.map(buildGameSummary) });
    return true;
  }

  if (pathname === "/api/games" && req.method === "POST") {
    const body = await readBody(req);
    const parsed = JSON.parse(body || "{}");
    if (!parsed.name || !parsed.state) {
      sendJson(res, 400, { error: "A game name and state are required." });
      return true;
    }

    const savedGames = readJson(savedGamesPath, { items: [] });
    const timestamp = new Date().toISOString();
    const item = {
      id: randomUUID(),
      name: String(parsed.name).trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
      state: parsed.state
    };
    savedGames.items.unshift(item);
    writeJson(savedGamesPath, savedGames);
    sendJson(res, 201, { item: buildGameSummary(item) });
    return true;
  }

  const gameMatch = pathname.match(/^\/api\/games\/([^/]+)$/);
  if (gameMatch && req.method === "GET") {
    const savedGames = readJson(savedGamesPath, { items: [] });
    const item = savedGames.items.find((entry) => entry.id === gameMatch[1]);
    if (!item) {
      sendJson(res, 404, { error: "Saved game not found." });
      return true;
    }
    sendJson(res, 200, { item });
    return true;
  }

  if (gameMatch && req.method === "DELETE") {
    const savedGames = readJson(savedGamesPath, { items: [] });
    const nextItems = savedGames.items.filter((entry) => entry.id !== gameMatch[1]);
    writeJson(savedGamesPath, { items: nextItems });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    send(res, 400, { "Content-Type": "text/plain; charset=utf-8" }, "Bad request");
    return;
  }

  const pathname = decodeURIComponent(req.url.split("?")[0]);

  try {
    if (pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, pathname);
      if (!handled) {
        sendJson(res, 404, { error: "Not found" });
      }
      return;
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
    return;
  }

  const requestedPath = safePathFromUrl(req.url);
  if (!requestedPath.startsWith(rootDir)) {
    send(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Forbidden");
    return;
  }

  fs.stat(requestedPath, (statError, stats) => {
    if (statError) {
      send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
      return;
    }

    const filePath = stats.isDirectory() ? path.join(requestedPath, "index.html") : requestedPath;
    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || "application/octet-stream";

    fs.readFile(filePath, (readError, content) => {
      if (readError) {
        send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Internal server error");
        return;
      }

      send(
        res,
        200,
        {
          "Cache-Control": "no-cache",
          "Content-Type": contentType
        },
        content
      );
    });
  });
});

server.listen(port, () => {
  console.log(`Beat4Beat server running at http://localhost:${port}`);
});
