export const searchConfig = {
    history: {
        enabled: true,
        directoryName: "results",
    },
    scrapers: {
        enabled: {
            franceTravail: true,
            meteojob: true,
            hellowork: true,
            glassdoor: true,
            cadremploi: true,
            apec: true,
            jobijoba: false,
        },
    },
    location: {
        city: "Trappes",
        postalCode: "78190",
        departmentCode: "78",
        inseeCode: "78621",
        radiusKm: 10,
    },
    filters: {
        excludedBroadLocations: ["Île-de-France"],
        excludedContracts: ["Alternance", "Stage"],
    },
    franceTravail: {
        locationCode: "78621",
    },
    apec: {
        locationId: "592230",
    },
    glassdoor: {
        locationPath: "trappes-emplois-SRCH_IL.0,7_IC2941075.htm",
        radiusMiles: 10,
    },
    cadremploi: {
        locationSlug: "trappes-78",
    },
    jobijoba: {
        radiusKm: 15,
    },
} as const;
