# Trouve un emploi

Collecte multi-source d'offres d'emploi, export CSV/JSON et API Fastify.

## Local usage

```powershell
npm install
npm run build
npm start
```

The collector keeps writing `data/jobs.csv` and `data/jobs.json` for the existing `jobs.html` workflow.

## PostgreSQL / Supabase API

Copy `.env.example` to `.env` and set `DATABASE_URL` to the server-side PostgreSQL connection string from Supabase. The API creates its tables and indexes automatically when it starts.

```powershell
npm run build
npm run api
```

Useful routes:

- `GET /health` checks the API and database connection.
- `GET /jobs?search=secretary&limit=100` returns normalized JSON jobs.
- `GET /jobs.csv?contract=CDI&limit=500` returns normalized CSV.
- `POST /scrape?locationCode=78168&radiusKm=20&limit=5000` runs a collection, deduplicates it, and stores it.

The `jobs.html` page can load the API CSV directly with the “Charger l’API” control. Keep `DATABASE_URL` and all scraper credentials on the backend; never put them in frontend code.

LinkedIn uses a dedicated local browser profile in `data/browser-state/linkedin-profile`. Run `npm run linkedin`, sign in manually in the window that opens on the first run, then rerun the command after the login is complete. The profile is ignored by Git and is never exported.

## Normalized data

Each stored job separates title, company, location, contract, salary, working time, remote work, experience, skills, publication date, description and source metadata. It also contains freshness and reliability scores. Jobs with the same normalized title, company and location are merged while their source URLs are retained in `extra.sourceUrls`.
