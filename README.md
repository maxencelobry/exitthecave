# Trouve un emploi

Collecte multi-source d'offres d'emploi avec export CSV/JSON local.

## Local usage

```powershell
npm install
npm run build
npm start
```

The collector keeps writing `data/jobs.csv` and `data/jobs.json` for the existing `jobs.html` workflow.

LinkedIn uses a dedicated local browser profile in `data/browser-state/linkedin-profile` when enabled in `src/config.ts`. The profile is ignored by Git and is never exported.

## Normalized data

Each stored job separates title, company, location, contract, salary, working time, remote work, experience, skills, publication date, description and source metadata. It also contains freshness and reliability scores. Jobs with the same normalized title, company and location are merged while their source URLs are retained in `extra.sourceUrls`.
