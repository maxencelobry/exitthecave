type CsvOffer = {
  site: string;
  title: string;
  url: string;
  extra: unknown;
};

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(" | ");
  return value == null ? "" : String(value);
}

function csvCell(value: unknown): string {
  const text = asText(value).replace(/\r?\n|\r/g, " ");
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeCsv(offers: CsvOffer[]): string {
  const headers = [
    "site",
    "lien",
    "intitulé",
    "entreprise",
    "localisation",
    "contrat",
    "temps_de_travail",
    "date_publication",
    "extra",
  ];
  const rows = offers.map(({ site, title, url, extra }) => {
    const fields = extra && typeof extra === "object" ? extra as Record<string, unknown> : {};
    const visibleInfo = Array.isArray(fields.visibleInfo) ? fields.visibleInfo : [];
    const searchableInfo = visibleInfo.map(asText).join(" | ");
    const contract = asText(fields.contract) || searchableInfo.match(/CDI|CDD|Intérim|Alternance|Freelance|Indépendant/i)?.[0] || "";
    const location = asText(fields.location) || searchableInfo.match(/[^|]*(?:\(\d{2}\)|-\s*\d{2})[^|]*/i)?.[0]?.trim() || "";
    const publishedAt = asText(fields.publishedAt) || searchableInfo.match(/[^|]*(?:il y a|hier|aujourd'hui|\d+\s*(?:heure|jour))/i)?.[0]?.trim() || "";

    return [
      site,
      url,
      title,
      fields.company,
      location,
      contract,
      fields.workTime,
      publishedAt,
      JSON.stringify(extra),
    ].map(csvCell).join(";");
  });

  return `\uFEFF${headers.map(csvCell).join(";")}\r\n${rows.join("\r\n")}\r\n`;
}
