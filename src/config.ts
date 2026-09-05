type FranceTravailRadiusKm = 5 | 10 | 20 | 30 | 40 | 50 | 100;

export const searchConfig = {
    history: {
        enabled: true,
        directoryName: "history",
    },
    scrapers: {
        enabled: {
            franceTravail: false,
            meteojob: false,
            hellowork: false,
            glassdoor: false,
            cadremploi: false,
            apec: false,
            jobijoba: false,
            linkedin: true,
        },
    },
    location: {
        city: "Coignières",
        postalCode: "78310",
        departmentCode: "78",
        inseeCode: "78168",
        radiusKm: 15,
    },
    filters: {
        excludedBroadLocations: ["Île-de-France"],
        excludedContracts: ["Alternance", "Stage"],
    },
    franceTravail: {
        locationCode: "78168",
        radiusKm: 20 as FranceTravailRadiusKm,
        credentialsFile:
            "C:/Users/maxen/Downloads/identifiants_jetrouvemonemploirapidementsvp.2026-09-01T11-26-12.json",
        api: {
            enabled: true,
        },
    },
    apec: {
        locationId: "592050",
    },
    glassdoor: {
        locationPath: "coignieres-emplois-SRCH_IL.0,10.htm",
        radiusMiles: 15,
    },
    cadremploi: {
        locationSlug: "coignieres-78",
    },
    jobijoba: {
        radiusKm: 15,
    },
    linkedin: {
        searchUrl:
            "https://www.linkedin.com/jobs/search-results/?keywords=publi%C3%A9%20au%20cours%20des%20derni%C3%A8res%2024%20heures&origin=SEMANTIC_SEARCH_LANDING_PAGE",
        maxPages: 50,
        loadDescriptions: true,
    },
} as const;
