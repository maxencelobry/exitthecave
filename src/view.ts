import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
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
    "/data/latest/collection.json": "data/latest/collection.json",
};

const contentTypes: Record<string, string> = {
    ".csv": "text/csv; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
};

let collector: ChildProcess | null = null;
let launchError: string | null = null;
function collectionStatus() {
    let report: Record<string, unknown> | null = null;
    try { report = JSON.parse(readFileSync(join(root, "data/latest/collection.json"), "utf8")); } catch { /* Older runs have no report. */ }
    let running = Boolean(collector);
    if (collector && report?.pid !== collector.pid) report = null;
    if (report?.state === "running" && typeof report.pid === "number") {
        try { process.kill(report.pid, 0); running = true; } catch {
            report = { ...report, state: "interrupted" };
        }
    }
    return { running, report, error: launchError };
}
const server = createServer((request, response) => {
    const pathname = request.url?.split("?")[0];
    if (pathname === "/api/collection") {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        if (request.method === "POST") {
            const origin = request.headers.origin;
            if (request.headers.host !== `127.0.0.1:${port}` || origin !== `http://127.0.0.1:${port}` || request.headers["x-collection-request"] !== "1") {
                response.writeHead(403); response.end(JSON.stringify({ error: "Origine non autorisée." })); return;
            }
            if (collectionStatus().running) { response.writeHead(409); response.end(JSON.stringify({ error: "Une collecte est déjà en cours." })); return; }
            launchError = null;
            collector = spawn(process.execPath, [fileURLToPath(new URL("./main.js", import.meta.url))], { cwd: root, windowsHide: true, stdio: "inherit" });
            collector.once("error", () => { launchError = "Impossible de démarrer la collecte."; collector = null; });
            collector.once("exit", (code) => { if (code !== 0) launchError = "Collecte interrompue. Consulter le journal local."; collector = null; });
            response.writeHead(202); response.end(JSON.stringify({ running: true })); return;
        }
        if (request.method !== "GET") { response.writeHead(405); response.end("{}"); return; }
        response.end(JSON.stringify(collectionStatus())); return;
    }
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
