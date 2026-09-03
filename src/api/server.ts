import Fastify from "fastify";
import { collectOffers } from "../index.js";
import { deduplicateJobs, normalizeOffer } from "../jobs/normalize.js";
import { writeNormalizedJobsCsv } from "../exporters/jobs-csv.js";
import { createPool, ensureSchema, queryJobs, upsertJobs, type JobQuery } from "../storage/postgres.js";

type SearchQuery = JobQuery & {
    locationCode?: string;
    radiusKm?: string;
    limit?: string;
};

const server = Fastify({ logger: true });
process.loadEnvFile?.();
const pool = createPool();

function numberParameter(value: string | undefined, fallback: number, max: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), max) : fallback;
}

function addCors(reply: { header: (name: string, value: string) => unknown }) {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
}

function requirePool(): NonNullable<typeof pool> {
    if (!pool) throw new Error("DATABASE_URL est absent : configure PostgreSQL ou Supabase dans .env");
    return pool;
}

server.options("*", async (_request, reply) => {
    addCors(reply);
    return reply.code(204).send();
});

server.get("/health", async (_request, reply) => {
    addCors(reply);
    if (!pool) return reply.send({ status: "ok", database: "not_configured" });
    await pool.query("SELECT 1");
    return reply.send({ status: "ok", database: "connected" });
});

server.get<{ Querystring: SearchQuery }>("/jobs", async (request, reply) => {
    addCors(reply);
    const jobs = await queryJobs(requirePool(), {
        search: request.query.search,
        company: request.query.company,
        contract: request.query.contract,
        site: request.query.site,
        limit: numberParameter(request.query.limit, 1000, 10_000),
    });
    return reply.send({ count: jobs.length, jobs });
});

server.get<{ Querystring: SearchQuery }>("/jobs.csv", async (request, reply) => {
    addCors(reply);
    const jobs = await queryJobs(requirePool(), {
        search: request.query.search,
        company: request.query.company,
        contract: request.query.contract,
        site: request.query.site,
        limit: numberParameter(request.query.limit, 1000, 10_000),
    });
    return reply
        .type("text/csv; charset=utf-8")
        .header("Content-Disposition", "attachment; filename=jobs.csv")
        .send(writeNormalizedJobsCsv(jobs));
});

server.post<{ Querystring: SearchQuery }>("/scrape", async (request, reply) => {
    addCors(reply);
    const options = {
        locationCode: request.query.locationCode,
        radiusKm: numberParameter(request.query.radiusKm, 20, 100),
        limit: numberParameter(request.query.limit, 10_000, 10_000),
    };
    const rawOffers = await collectOffers(options);
    const jobs = deduplicateJobs(rawOffers.map((offer) => normalizeOffer(offer.site ?? "unknown", offer)));
    await upsertJobs(requirePool(), jobs);
    return reply.send({ collected: rawOffers.length, unique: jobs.length, jobs });
});

async function start(): Promise<void> {
    if (pool) {
        await ensureSchema(pool);
        server.log.info("Schéma PostgreSQL vérifié");
    } else {
        server.log.warn("DATABASE_URL absente : l'API démarrera, mais les routes jobs nécessitent une base");
    }
    const port = numberParameter(process.env.PORT, 3000, 65_535);
    await server.listen({ host: process.env.HOST ?? "127.0.0.1", port });
}

start().catch((error) => {
    server.log.error(error);
    process.exitCode = 1;
});
