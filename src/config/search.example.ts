/**
 * Example configuration for changing the search area.
 * Copy the relevant values into search.ts.
 *
 * The last-24-hours filter is automatic and must not be configured here.
 */
export const searchConfigExample = {
    history: {
        // Skip offers already found in an earlier run when enabled.
        enabled: true,
        directoryName: "results",
    },

    scrapers: {
        enabled: {
            // Set a scraper to false to skip it completely.
            franceTravail: true,
            meteojob: true,
            hellowork: true,
            glassdoor: false,
            cadremploi: true,
            apec: true,
            jobijoba: false,
            linkedin: false,
        },
    },

    location: {
        // Name used by HelloWork and Meteojob.
        city: "Coignières",
        postalCode: "78310",
        departmentCode: "78",
        // INSEE code of the municipality, available from the INSEE website
        // or in the France Travail search URL.
        inseeCode: "78168",
        radiusKm: 10,
    },

    filters: {
        // Exclude offers that only provide a broad region instead of a city.
        excludedBroadLocations: ["Île-de-France"],
        // Change this list to include or allow other contract types.
        excludedContracts: ["Alternance", "Stage"],
    },

    franceTravail: {
        // Location identifier used by France Travail:
        // /offres/emploi/coignieres/... -> locationCode = "78168"
        locationCode: "78168",
        // France Travail supports radius values such as 5, 10 and 20 km.
        radiusKm: 20,
        api: {
            // The API complements the browser scraper and removes the 1,000-result UI limit.
            enabled: true,
        },
    },

    apec: {
        // APEC location identifier from the Location field autocomplete.
        // Endpoint : /cms/webservices/autocompletion/lieuautocomplete?q=VILLE
        locationId: "592050",
    },

    glassdoor: {
        // Copy the path after /Emploi/ from the Glassdoor URL.
        locationPath: "coignieres-emplois-SRCH_IL.0,10.htm",
        // Glassdoor expects miles: 10 km is approximately 7 miles.
        radiusMiles: 7,
    },

    cadremploi: {
        // Slug used in the URL: city + department.
        locationSlug: "coignieres-78",
    },

    jobijoba: {
        // Jobijoba uses a dedicated perimeter in kilometers.
        radiusKm: 15,
    },

    linkedin: {
        // Public-only collection. Do not add cookies or account credentials here.
        searchUrl:
            "https://www.linkedin.com/jobs/search-results/?keywords=publi%C3%A9%20au%20cours%20des%20derni%C3%A8res%2024%20heures&origin=SEMANTIC_SEARCH_LANDING_PAGE",
        maxPages: 50,
    },
} as const;
