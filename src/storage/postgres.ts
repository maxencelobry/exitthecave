import { Pool, type PoolClient } from "pg";
import type { NormalizedJob } from "../jobs/model.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
    id BIGSERIAL PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    site TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    company TEXT,
    location TEXT,
    contract TEXT,
    salary TEXT,
    work_time TEXT,
    remote TEXT,
    experience TEXT,
    skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    published_at TIMESTAMPTZ,
    freshness_label TEXT NOT NULL,
    freshness_score INTEGER NOT NULL,
    reliability_score INTEGER NOT NULL,
    reliability_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    description TEXT,
    extra JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jobs_published_at_idx ON jobs (published_at DESC);
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs (company);
CREATE INDEX IF NOT EXISTS jobs_location_idx ON jobs (location);
CREATE INDEX IF NOT EXISTS jobs_contract_idx ON jobs (contract);
`;

export type JobQuery = {
    search?: string | undefined;
    company?: string | undefined;
    contract?: string | undefined;
    site?: string | undefined;
    limit?: number;
};

export function createPool(): Pool | null {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    const options = {
        connectionString,
        max: Number(process.env.DATABASE_POOL_MAX ?? 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    };
    return new Pool(process.env.NODE_ENV === "production" ? { ...options, ssl: { rejectUnauthorized: false } } : options);
}

export async function ensureSchema(pool: Pool): Promise<void> {
    await pool.query(SCHEMA);
}

function dateParameter(value: string | null): string | null {
    if (!value) return null;
    return Number.isNaN(Date.parse(value)) ? null : value;
}

async function upsertJob(client: PoolClient, job: NormalizedJob): Promise<void> {
    const existing = await client.query<{ id: number }>(
        "SELECT id FROM jobs WHERE fingerprint = $1 OR url = $2 LIMIT 1",
        [job.fingerprint, job.url],
    );
    const values = [
        job.fingerprint,
        job.site,
        job.title,
        job.url,
        job.company,
        job.location,
        job.contract,
        job.salary,
        job.workTime,
        job.remote,
        job.experience,
        JSON.stringify(job.skills),
        dateParameter(job.publishedAt),
        job.freshnessLabel,
        job.freshnessScore,
        job.reliabilityScore,
        JSON.stringify(job.reliabilityReasons),
        job.description,
        JSON.stringify(job.extra),
    ];
    const existingRow = existing.rows[0];
    if (existingRow) {
        await client.query(
            `UPDATE jobs SET
                fingerprint = $1, site = $2, title = $3, url = $4, company = $5, location = $6,
                contract = $7, salary = $8, work_time = $9, remote = $10, experience = $11,
                skills = $12::jsonb, published_at = $13, freshness_label = $14, freshness_score = $15,
                reliability_score = $16, reliability_reasons = $17::jsonb, description = $18,
                extra = $19::jsonb, last_seen_at = NOW()
             WHERE id = $20`,
            [...values, existingRow.id],
        );
        return;
    }
    await client.query(
        `INSERT INTO jobs (
            fingerprint, site, title, url, company, location, contract, salary, work_time,
            remote, experience, skills, published_at, freshness_label, freshness_score,
            reliability_score, reliability_reasons, description, extra
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17::jsonb, $18, $19::jsonb)`,
        values,
    );
}

export async function upsertJobs(pool: Pool, jobs: NormalizedJob[]): Promise<void> {
    if (!jobs.length) return;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const job of jobs) await upsertJob(client, job);
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function queryJobs(pool: Pool, query: JobQuery): Promise<NormalizedJob[]> {
    const conditions: string[] = [];
    const values: string[] = [];
    const add = (condition: string, value: string) => {
        values.push(value);
        conditions.push(condition.replace("?", `$${values.length}`));
    };
    if (query.search) {
        const searchValue = `%${query.search}%`;
        const placeholders = [searchValue, searchValue, searchValue, searchValue].map((value) => {
            values.push(value);
            return `$${values.length}`;
        });
        conditions.push(
            `(title ILIKE ${placeholders[0]} OR company ILIKE ${placeholders[1]} OR location ILIKE ${placeholders[2]} OR description ILIKE ${placeholders[3]})`,
        );
    }
    if (query.company) add("company ILIKE ?", `%${query.company}%`);
    if (query.contract) add("contract ILIKE ?", `%${query.contract}%`);
    if (query.site) add("site = ?", query.site);
    const limit = Math.min(Math.max(query.limit ?? 1000, 1), 10_000);
    const result = await pool.query<NormalizedJob>(
        `SELECT
            fingerprint, site, title, url, company, location, contract, salary, "work_time" AS "workTime",
            remote, experience, skills, "published_at" AS "publishedAt", "freshness_label" AS "freshnessLabel",
            "freshness_score" AS "freshnessScore", "reliability_score" AS "reliabilityScore",
            "reliability_reasons" AS "reliabilityReasons", description, extra
         FROM jobs
         ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY published_at DESC NULLS LAST, id DESC
         LIMIT ${limit}`,
        values,
    );
    return result.rows;
}
