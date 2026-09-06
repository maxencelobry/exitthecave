# ExitTheCave

ExitTheCave is a local job-search workspace for the **French job market**. It collects French job listings, keeps a broad set of relevant opportunities, and lets you review them quickly in a calm interface.

It runs on your computer, keeps personal results and browser sessions local, and uses a transparent weighted-keyword ranking. It is not an application bot and does not predict hiring decisions.

## Start here

Requirement: Node.js 20 or newer.

```bash
npm install
npm run build
npm start
```

In a second terminal, start the local viewer:

```bash
npm run view
```

Open <http://127.0.0.1:4173>.

The viewer reads `data/latest/jobs.csv`. If no result file exists yet, run the collector first.

## Create a personal search

1. Open [`PROMPT.md`](PROMPT.md).
2. Give the prompt to ChatGPT with your CV. Never attach passwords, cookies or login files.
3. Answer the questions, or ask for quick mode and validate the proposed search universe.
4. Paste only the returned JSON into `data/config.json`.
5. Run `npm run build && npm start`.

The prompt is designed for high recall across the French market: it includes adjacent roles and transferable skills instead of filtering only jobs where the CV already looks perfect. Human-readable configuration values are French; the file shape is validated by `src/config.ts`.

## What the collector does

- Collects from the enabled French-market sources in `data/config.json`.
- Normalises contracts, locations, salaries, publication dates and descriptions.
- Applies explicit exclusions before writing results.
- Uses local history to avoid returning the same URL as a new result twice.
- Archives each run in `data/history/`.
- Writes current results to `data/latest/jobs.csv` and `data/latest/jobs.json`.
- Writes source progress to `data/latest/collection.json`.

Publication dates come from each source and may be delayed, refreshed or inconsistent. A source may expose older offers even when a search wording suggests a recent window. Always open the original French listing before applying.

## How ranking works

The ranking is intentionally easy to understand:

- each matching weighted keyword adds its configured weight;
- a keyword found in the title receives a stronger bonus;
- preferred contracts add a bonus once;
- avoided contracts receive a penalty once;
- explicit exclusions remove an offer from the viewer.

`targetRoles`, `mustHave`, `niceToHave` and `preferences` document the search profile. `weightedKeywords`, contract scoring and active exclusions are the fields that currently affect ranking or visibility. A missing CV skill is not automatically a rejection.

## Viewer workflow

The interface separates **Reload results** (reread saved files) from **Start collection** (launch collectors). The **Offers**, **To review** and **Applications** views keep review focused. Each offer can be marked opened, to review or application sent.

Filtering and tracking state are stored in the browser. Personal configuration, results, history and browser sessions are ignored by Git; example files are safe to commit.

## Optional France Travail API

The browser collector works without API credentials. To add the optional API, set a local credentials path in `data/config.json` and enable `franceTravail.api.enabled`. Never paste credentials into ChatGPT or commit them.

## Project map

```text
src/                 collectors, normalisation, history and exporters
data/config.json     personal local configuration (ignored)
data/examples/       safe sample configuration and result files
data/latest/         latest local results and diagnostics (ignored)
data/history/        archived local result files (ignored)
data/browser-state/  persistent browser sessions (ignored)
public/jobs.html     local offer viewer
public/app.js        viewer behaviour and ranking display
public/styles.css    viewer design system
PROMPT.md            CV questionnaire and JSON generator prompt
```

## Development checks

```bash
npm run build
node --check public/app.js
git diff --check
```

ExitTheCave is intentionally local and evolving. Treat source selectors as maintenance points, and verify every important offer on its original French website.
