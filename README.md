# exitTheCave

`exitTheCave` is a local, privacy-friendly job-search workspace. It collects job links from the configured sources and lets you search, sort and review them quickly in one clean interface.

> **Freshness notice:** the collector targets jobs published during the last 24 hours only. Some websites expose an incorrect, delayed or refreshed publication date, so the first few runs may still contain older-looking offers or duplicates. Run it regularly for a few days: the local history learns the links already seen and removes them from future result files.

## Quick start

Requirements: Node.js 20+.

```bash
npm install
npm run build
npm start
```

Then open the viewer in another terminal:

```bash
npm run view
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The viewer reads the latest local files from `data/latest/` and never needs a hosted API.

## Personalise your search

1. Open [`PROMPT.md`](PROMPT.md).
2. Send the prompt to ChatGPT together with your CV.
3. Answer its questionnaire, or request the quick mode and validate the proposed search universe.
4. Paste the returned JSON exactly into `data/config.json`.
5. Start the collector with `npm run build && npm start`.

`src/config.ts` loads and validates `data/config.json` at startup. The viewer loads the same file automatically when it exists, so the search and ranking stay aligned with the collectors. It loads `data/latest/jobs.csv` automatically on every start, so the most recent local result is ready immediately.

### France Travail API

The browser scraper works without an API account. The optional France Travail API can complement it and help retrieve more results than the website pagination limit. In [`data/config.example.json`](data/config.example.json), set `franceTravail.credentialsFile` to the absolute path of your local France Travail credentials JSON, then set `franceTravail.api.enabled` to `true`. Keep both the credentials file and your personal `data/config.json` out of GitHub.

The generated configuration uses the public/browser collectors. France Travail's optional API remains disabled until you add your own credentials path manually; never paste credentials into ChatGPT or commit them.

The prompt creates a weighted keyword list from the CV. Ranking stays intentionally simple: matching weights are added, title matches receive a stronger bonus, and contract bonuses or penalties adjust the result. The generated configuration always uses the same JSON shape and French human-readable values.

## What the viewer provides

- fast text search and filters;
- profile-relevance or newest-first sorting;
- weighted CV score filters;
- title-first matching with clear contract bonuses and penalties;
- list and compact review modes;
- visited-offer tracking in the browser;
- ignored-company filtering;
- local CSV loading, with a manual file picker fallback;
- a direct link back to this repository.

The viewer separates **Reload results** (read the saved files again) from **Start collection** (launch the configured collectors; LinkedIn may open a sign-in window). It shows the collection date and each source's status, page count, recovered offers, new offers and stop reason. Older files without diagnostics are shown as unknown. A completed source means an observed end of its available navigation, not a guarantee that the website exposes every job.

Each offer has expandable details and separate opened, review-later and application-sent states. Legacy “processed” states are retained separately. Ignored companies persist in the browser and are not cleared by resetting search filters.

`profile.contractScoring.preferred` adds 8 raw points and `avoided` subtracts 35, once each before score conversion. Empty arrays disable those adjustments. `profile.exclusions.roles`, `contracts` and `locations` filter the viewer, including imported CSVs. Company exclusions initialise the editable ignored-company list. `mustHave`, `preferences` and role priorities are documentary; they do not enforce eligibility or automatically score salary, remote work or distance. `targetRoles` and `niceToHave` only generate fallback keywords when `weightedKeywords` is empty.

The generated files are kept locally in `data/latest/`. Example files only are committed to GitHub; personal results, browser sessions and history are ignored.

The 24-hour window is applied by the collectors and is not a promise made by the job websites themselves. Always check the publication date on the original offer before applying.

## Project layout

```text
src/                 collectors, normalisation and exporters
data/examples/       safe sample CSV and JSON files
data/config.json     personal search configuration (paste the prompt output here)
data/latest/          current local results (ignored)
data/history/        previous local results (ignored)
data/browser-state/  persistent browser sessions (ignored)
public/jobs.html     local job viewer
PROMPT.md            CV questionnaire and configuration prompt
```

## Status

The project is intentionally local and free to use. Sources and selectors are evolving; always review an offer on its original website before applying.
