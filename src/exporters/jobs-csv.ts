import type { NormalizedJob } from "../jobs/model.js";

function csvCell(value: unknown): string {
    const text = value == null ? "" : String(value).replace(/\r?\n|\r/g, " ");
    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeNormalizedJobsCsv(jobs: NormalizedJob[]): string {
    const headers = [
        "site",
        "lien",
        "intitulé",
        "entreprise",
        "localisation",
        "contrat",
        "salaire",
        "temps_de_travail",
        "teletravail",
        "experience",
        "competences",
        "date_publication",
        "fraicheur",
        "score_fraicheur",
        "score_fiabilite",
        "raisons_fiabilite",
        "description",
    ];
    const rows = jobs.map((job) =>
        [
            job.site,
            job.url,
            job.title,
            job.company,
            job.location,
            job.contract,
            job.salary,
            job.workTime,
            job.remote,
            job.experience,
            job.skills.join(" | "),
            job.publishedAt,
            job.freshnessLabel,
            job.freshnessScore,
            job.reliabilityScore,
            job.reliabilityReasons.join(" | "),
            job.description,
        ]
            .map(csvCell)
            .join(";"),
    );
    return `\uFEFF${headers.map(csvCell).join(";")}\r\n${rows.join("\r\n")}\r\n`;
}
