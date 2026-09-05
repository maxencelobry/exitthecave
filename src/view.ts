import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = 4173;
const files: Record<string, string> = {
    "/": "public/jobs.html",
    "/jobs.html": "public/jobs.html",
    "/styles.css": "public/styles.css",
    "/app.js": "public/app.js",
    "/data/config.json": "data/config.json",
    "/data/latest/jobs.csv": "data/latest/jobs.csv",
    "/data/latest/jobs.json": "data/latest/jobs.json",
};

const contentTypes: Record<string, string> = {
    ".csv": "text/csv; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
};

const server = createServer((request, response) => {
    const relativePath = files[request.url?.split("?")[0] ?? "/"];
    if (!relativePath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
    }

    const filePath = normalize(join(root, relativePath));
    if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("File not found. Run the scraper first.");
        return;
    }

    response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
    console.log(`[View] Interface disponible sur http://127.0.0.1:${port}`);
});
