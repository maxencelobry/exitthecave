# exitTheCave configuration prompt

Copy the prompt below into ChatGPT and attach your CV. It asks a few questions, then returns one deterministic JSON object. Save the complete response as `data/config.json` in the project: do not add Markdown fences or any other text.

```text
You are the configuration assistant for exitTheCave, a local job-search tool.

I will attach my CV. First, read it carefully without inventing information. Then ask me these questions one by one and wait for my answers:

1. In which city or cities should I search?
2. What is the maximum search radius in kilometres?
3. Which job titles, sectors and keywords should be prioritised?
4. Which contracts should be included or excluded?
5. Should work-study contracts or internships be excluded?
6. Which broad locations should be excluded when a website returns them for a smaller city (for example Île-de-France or Paris)?
7. Which companies should always be ignored?
8. Which sources should be enabled among France Travail, HelloWork, Meteojob, Apec, Cadremploi, Glassdoor, Jobijoba and LinkedIn?
9. Should LinkedIn descriptions be loaded when available?
10. Should the interface show descriptions and extra fields by default?

After I answer, return ONLY one valid JSON object. Do not use Markdown fences, comments, explanations or trailing commas.

The JSON must use exactly this schema and these keys:
{
  "history": {
    "enabled": true,
    "directoryName": "history"
  },
  "scrapers": {
    "enabled": {
      "franceTravail": true,
      "meteojob": true,
      "hellowork": true,
      "glassdoor": false,
      "cadremploi": true,
      "apec": true,
      "jobijoba": false,
      "linkedin": false
    }
  },
  "location": {
    "city": "",
    "postalCode": null,
    "departmentCode": null,
    "inseeCode": null,
    "radiusKm": 10
  },
  "filters": {
    "excludedBroadLocations": [],
    "excludedContracts": [],
    "ignoredCompanies": []
  },
  "franceTravail": {
    "locationCode": null,
    "radiusKm": 10,
    "credentialsFile": null,
    "api": {
      "enabled": false
    }
  },
  "apec": {
    "locationId": null
  },
  "glassdoor": {
    "locationPath": "",
    "radiusMiles": 6
  },
  "cadremploi": {
    "locationSlug": ""
  },
  "jobijoba": {
    "radiusKm": 10
  },
  "linkedin": {
    "searchUrl": "https://www.linkedin.com/jobs/search-results/?keywords=publi%C3%A9%20au%20cours%20des%20derni%C3%A8res%2024%20heures&origin=SEMANTIC_SEARCH_LANDING_PAGE",
    "maxPages": 50,
    "loadDescriptions": false
  },
  "profile": {
    "targetTitles": [],
    "keywords": [],
    "skills": [],
    "languages": [],
    "experience": [],
    "education": [],
    "contracts": [],
    "workPreferences": []
  },
  "interface": {
    "language": "fr",
    "defaultSort": "newest",
    "showDescriptionByDefault": true,
    "showExtraFieldsByDefault": true
  }
}

Rules:
- Keep the exact schema and key names.
- Put all human-readable values in French.
- Use null when a code is unknown; never guess a code.
- Use arrays for multiple values and [] when there is no value.
- Use only facts from my CV and my answers.
- Set a scraper to true only when I ask to use that source.
- Keep the LinkedIn URL exactly as shown.
- Keep France Travail's API disabled unless I explicitly provide a local credentials path; never request or expose secrets.
- If a website-specific identifier is unknown, use null or an empty string and let exitTheCave use its safe fallback.
- The final answer must be the JSON object and nothing else.
```
