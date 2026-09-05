export type RawOffer = {
    site?: string;
    title: string;
    url: string;
    extra: unknown;
};

export type NormalizedJob = {
    fingerprint: string;
    site: string;
    title: string;
    url: string;
    company: string | null;
    location: string | null;
    contract: string | null;
    salary: string | null;
    workTime: string | null;
    remote: string | null;
    experience: string | null;
    skills: string[];
    publishedAt: string | null;
    freshnessLabel: "today" | "recent" | "old" | "unknown";
    freshnessScore: number;
    reliabilityScore: number;
    reliabilityReasons: string[];
    description: string | null;
    extra: Record<string, unknown>;
};
