const STORAGE_VISITED = "exit-the-cave-visited";
const STORAGE_APPLIED = "exit-the-cave-applied";
const STORAGE_IGNORED = "exit-the-cave-ignored";
const PAGE_SIZE = 40;
const FALLBACK_CONFIG = {
    filters: { excludedBroadLocations: [], excludedContracts: [], ignoredCompanies: [] },
    profile: { targetTitles: [], keywords: [], skills: [], languages: [], experience: [], education: [], contracts: [], workPreferences: [] },
    interface: { defaultSort: "fit", showDescriptionByDefault: false, showExtraFieldsByDefault: true },
};

let config = FALLBACK_CONFIG;
let offers = [];
let filtered = [];
let page = 1;
let visited = readSet(STORAGE_VISITED);
let applied = readSet(STORAGE_APPLIED);

const $ = (selector) => document.querySelector(selector);
const elements = {
    search: $("#search"),
    site: $("#site"),
    contract: $("#contract"),
    status: $("#status-filter"),
    sort: $("#sort"),
    fit: $("#fit-filter"),
    details: $("#detail-mode"),
    ignored: $("#excluded-companies"),
    file: $("#file"),
    results: $("#results"),
    pagination: $("#pagination"),
    visible: $("#visible-count"),
    total: $("#total-count"),
    visited: $("#visited-count"),
    statusText: $("#status"),
};

function readSet(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "[]");
        return new Set(Array.isArray(value) ? value : []);
    } catch {
        return new Set();
    }
}

function saveSet(key, value) {
    localStorage.setItem(key, JSON.stringify([...value]));
}

function text(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value) {
    return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

function array(value) {
    return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function parseCsv(source) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const input = source.replace(/^\uFEFF/, "");
    for (let index = 0; index < input.length; index += 1) {
        const character = input[index];
        const next = input[index + 1];
        if (character === '"' && quoted && next === '"') {
            cell += '"';
            index += 1;
        } else if (character === '"') quoted = !quoted;
        else if (character === ";" && !quoted) {
            row.push(cell);
            cell = "";
        } else if ((character === "\n" || character === "\r") && !quoted) {
            if (character === "\r" && next === "\n") index += 1;
            row.push(cell);
            if (row.some(Boolean)) rows.push(row);
            row = [];
            cell = "";
        } else cell += character;
    }
    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }
    const headers = rows.shift() || [];
    return rows.map((values) => {
        const offer = Object.fromEntries(headers.map((header, index) => [header, text(values[index])]));
        offer._key = text(offer.lien) || `${offer.site}|${offer.intitulé}|${offer.localisation}`;
        offer._search = Object.values(offer).join(" ").toLocaleLowerCase("fr");
        offer._date = dateValue(offer.date_publication);
        const match = compatibility(offer);
        offer._fit = match.score;
        offer._reasons = match.reasons;
        return offer;
    });
}

function dateValue(value) {
    const source = normalized(value);
    if (!source) return 0;
    if (source.includes("aujourd") || source.includes("moins d'une heure")) return Date.now();
    if (source.includes("hier")) return Date.now() - 86400000;
    const relative = source.match(/(?:il y a|moins de)\s*(\d+)?\s*(minute|heure|jour|semaine)/);
    if (relative) {
        const units = { minute: 60000, heure: 3600000, jour: 86400000, semaine: 604800000 };
        return Date.now() - Number(relative[1] || 0) * units[relative[2]];
    }
    const french = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (french) return new Date(`${french[3].length === 2 ? `20${french[3]}` : french[3]}-${french[2]}-${french[1]}`).getTime();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function displayDate(value) {
    const timestamp = dateValue(value);
    if (!timestamp) return text(value) || "Date inconnue";
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function profileTerms() {
    const profile = config.profile || FALLBACK_CONFIG.profile;
    return [
        ...array(profile.targetTitles).map((value) => [value, 8, "métier"]),
        ...array(profile.keywords).map((value) => [value, 5, "mot-clé"]),
        ...array(profile.skills).map((value) => [value, 4, "compétence"]),
        ...array(profile.languages).map((value) => [value, 2, "langue"]),
        ...array(profile.experience).map((value) => [value, 3, "expérience"]),
        ...array(profile.education).map((value) => [value, 2, "formation"]),
        ...array(profile.contracts).map((value) => [value, 3, "contrat"]),
        ...array(profile.workPreferences).map((value) => [value, 2, "préférence"]),
    ];
}

const TOKEN_ALIASES = new Map([
    ["assistante", "assistant"],
    ["administrative", "administratif"],
    ["secretaire", "secretariat"],
    ["secretariat", "secretariat"],
    ["gestionnaire", "gestion"],
    ["gerer", "gestion"],
    ["gere", "gestion"],
    ["dossiers", "dossier"],
    ["donnees", "donnee"],
    ["clients", "client"],
    ["entreprises", "entreprise"],
    ["bureautique", "bureau"],
    ["organisation", "organiser"],
    ["organise", "organiser"],
    ["organisee", "organiser"],
]);

function tokens(value) {
    return normalized(value)
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .map((token) => TOKEN_ALIASES.get(token) || token)
        .filter((token) => token.length > 2);
}

function termMatches(term, haystack, haystackTokens) {
    const phrase = normalized(term);
    if (!phrase) return false;
    if (haystack.includes(phrase)) return true;
    const wanted = tokens(term);
    if (!wanted.length) return false;
    const matches = wanted.filter((wantedToken) =>
        haystackTokens.some((candidate) => candidate === wantedToken || (wantedToken.length > 5 && candidate.startsWith(wantedToken.slice(0, 5)))),
    );
    return matches.length === wanted.length || (wanted.length > 1 && matches.length / wanted.length >= 0.75);
}

function compatibility(offer) {
    const terms = profileTerms();
    if (!terms.length) return { score: 50, reasons: ["profil à personnaliser"] };
    const title = normalized(offer.intitulé);
    const haystack = normalized([offer.intitulé, offer.description, offer.competences, offer.contrat, offer.temps_de_travail, offer.localisation, offer.extra].join(" "));
    const haystackTokens = tokens(haystack);
    let totalWeight = 0;
    let matchedWeight = 0;
    let titleWeight = 0;
    let matchedTitleWeight = 0;
    const reasons = [];
    for (const [term, weight, category] of terms) {
        totalWeight += weight;
        const matched = termMatches(term, haystack, haystackTokens);
        if (category === "métier") {
            titleWeight += weight;
            if (termMatches(term, title, tokens(title))) matchedTitleWeight += weight;
        }
        if (matched) {
            matchedWeight += weight;
            if (reasons.length < 4) reasons.push(`${category} : ${term}`);
        }
    }
    const titleCoverage = titleWeight ? matchedTitleWeight / titleWeight : matchedWeight / totalWeight;
    const profileCoverage = matchedWeight / totalWeight;
    const contract = normalized(offer.contrat);
    const wantedContracts = array(config.profile?.contracts).map(normalized);
    const contractBonus = wantedContracts.length && wantedContracts.some((wanted) => contract.includes(wanted)) ? 8 : 0;
    const freshness = normalized(offer.fraicheur);
    const freshnessBonus = freshness.includes("aujourd") || freshness.includes("today") ? 3 : 0;
    const score = Math.min(99, Math.round(titleCoverage * 48 + profileCoverage * 44 + contractBonus + freshnessBonus));
    return { score, reasons: reasons.length ? reasons : ["aucun critère détecté"] };
}

function ignoredCompanies() {
    const configured = array(config.filters?.ignoredCompanies).map(normalized);
    const manual = text(elements.ignored.value).split(",").map(normalized).filter(Boolean);
    return [...new Set([...configured, ...manual])];
}

function fillOptions(select, values) {
    select.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
    [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")).forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
    });
}

function applyFilters() {
    const tokens = normalized(elements.search.value).split(" ").filter(Boolean);
    const ignored = ignoredCompanies();
    const excludedLocations = array(config.filters?.excludedBroadLocations).map(normalized);
    const excludedContracts = array(config.filters?.excludedContracts).map(normalized);
    filtered = offers.filter((offer) => {
        const isVisited = visited.has(offer._key);
        const isApplied = applied.has(offer._key);
        const location = normalized(offer.localisation);
        const contract = normalized(offer.contrat);
        return tokens.every((token) => offer._search.includes(token)) &&
            (!elements.site.value || offer.site === elements.site.value) &&
            (!elements.contract.value || offer.contrat === elements.contract.value) &&
            (!elements.fit.value || offer._fit >= Number(elements.fit.value)) &&
            (!ignored.some((company) => normalized(offer.entreprise).includes(company))) &&
            (!excludedLocations.some((value) => value && location.includes(value))) &&
            (!excludedContracts.some((value) => value && contract.includes(value))) &&
            (elements.status.value === "all" || (elements.status.value === "visited" && isVisited) || (elements.status.value === "unvisited" && !isVisited) || (elements.status.value === "applied" && isApplied));
    });
    filtered.sort((a, b) => elements.sort.value === "newest" ? b._date - a._date : elements.sort.value === "oldest" ? a._date - b._date : b._fit - a._fit || b._date - a._date);
    page = 1;
    render();
}

function createCard(offer) {
    const card = document.createElement("article");
    card.className = `job-card${visited.has(offer._key) ? " visited" : ""}`;
    const main = document.createElement("div");
    main.className = "job-main";
    const head = document.createElement("div");
    head.className = "job-head";
    const title = document.createElement("h2");
    title.className = "job-title";
    const link = document.createElement("a");
    link.href = offer.lien || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = offer.intitulé || "Offre sans intitulé";
    link.addEventListener("click", () => { visited.add(offer._key); saveSet(STORAGE_VISITED, visited); render(); });
    title.append(link);
    head.append(title);
    main.append(head);
    const meta = document.createElement("div");
    meta.className = "job-meta";
    [offer.entreprise, offer.localisation, displayDate(offer.date_publication)].filter(Boolean).forEach((value) => { const item = document.createElement("span"); item.textContent = value; meta.append(item); });
    main.append(meta);
    const badges = document.createElement("div");
    badges.className = "job-extra";
    [offer.site, offer.contrat, offer.salaire, offer.teletravail].filter(Boolean).forEach((value) => { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = value; badges.append(badge); });
    main.append(badges);
    const reasons = document.createElement("div");
    reasons.className = "reasons";
    offer._reasons.forEach((value) => { const reason = document.createElement("span"); reason.className = "reason"; reason.textContent = value; reasons.append(reason); });
    main.append(reasons);
    if (elements.details.value !== "compact" && offer.description) { const description = document.createElement("p"); description.className = "job-description"; description.textContent = offer.description; main.append(description); }
    const actions = document.createElement("div");
    actions.className = "job-actions";
    const open = document.createElement("a");
    open.className = "open-link";
    open.href = offer.lien || "#";
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "Voir l'offre ↗";
    open.addEventListener("click", () => { visited.add(offer._key); saveSet(STORAGE_VISITED, visited); });
    actions.append(open);
    const mark = document.createElement("button");
    mark.type = "button";
    mark.textContent = applied.has(offer._key) ? "✓ Traitée" : "Marquer traitée";
    mark.addEventListener("click", () => { applied.has(offer._key) ? applied.delete(offer._key) : applied.add(offer._key); saveSet(STORAGE_APPLIED, applied); applyFilters(); });
    actions.append(mark);
    main.append(actions);
    const match = document.createElement("aside");
    match.className = "match";
    const score = document.createElement("strong");
    score.className = "match-score";
    score.textContent = `${offer._fit}%`;
    const label = document.createElement("span");
    label.className = "match-label";
    label.textContent = "compatibilité";
    const bar = document.createElement("span");
    bar.className = "match-bar";
    const fill = document.createElement("i");
    fill.style.width = `${offer._fit}%`;
    bar.append(fill);
    match.append(score, label, bar);
    card.append(main, match);
    return card;
}

function render() {
    const start = (page - 1) * PAGE_SIZE;
    elements.results.replaceChildren();
    filtered.slice(start, start + PAGE_SIZE).forEach((offer) => elements.results.append(createCard(offer)));
    if (!filtered.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = offers.length ? "Aucune offre ne correspond à ces critères." : "Aucun résultat local. Lance le scraper puis recharge la page."; elements.results.append(empty); }
    elements.visible.textContent = filtered.length.toLocaleString("fr-FR");
    elements.total.textContent = offers.length.toLocaleString("fr-FR");
    elements.visited.textContent = offers.filter((offer) => visited.has(offer._key)).length.toLocaleString("fr-FR");
    elements.statusText.textContent = `${filtered.length.toLocaleString("fr-FR")} offre(s) affichée(s) · page ${filtered.length ? page : 0}/${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}`;
    renderPagination();
}

function renderPagination() {
    elements.pagination.replaceChildren();
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    if (totalPages < 2) return;
    for (let index = 1; index <= totalPages; index += 1) {
        if (totalPages > 8 && index > 3 && index < totalPages - 2 && Math.abs(index - page) > 1) { if (!elements.pagination.querySelector(".ellipsis")) { const gap = document.createElement("span"); gap.className = "ellipsis"; gap.textContent = "…"; elements.pagination.append(gap); } continue; }
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = index;
        button.className = index === page ? "active" : "";
        button.addEventListener("click", () => { page = index; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
        elements.pagination.append(button);
    }
}

async function loadConfig() {
    try {
        const response = await fetch("data/config.json", { cache: "no-store" });
        if (!response.ok) throw new Error("configuration absente");
        config = { ...FALLBACK_CONFIG, ...(await response.json()) };
        $("#config-state").textContent = `Configuration · ${config.location?.city || "locale"}`;
        $("#search-summary").textContent = `Recherche personnalisée pour ${config.location?.city || "ton secteur"}, selon ton profil et tes critères.`;
        $("#profile-summary").textContent = `Profil actif · ${array(config.profile?.targetTitles).slice(0, 4).join(" · ") || "à personnaliser"}`;
        $("#profile-detail").textContent = `${array(config.profile?.keywords).length + array(config.profile?.skills).length} critères utilisés pour classer les offres.`;
        elements.ignored.value = array(config.filters?.ignoredCompanies).join(", ");
        elements.sort.value = ["fit", "newest", "oldest"].includes(config.interface?.defaultSort) ? config.interface.defaultSort : "newest";
        if (config.interface?.showDescriptionByDefault === false) elements.details.value = "compact";
    } catch {
        $("#config-state").textContent = "Configuration par défaut";
    }
}

async function loadLatest() {
    try {
        const response = await fetch("data/latest/jobs.csv", { cache: "no-store" });
        if (!response.ok) throw new Error("résultat absent");
        loadText(await response.text());
    } catch {
        elements.statusText.textContent = "Le dernier résultat est indisponible : importe un CSV ou lance le scraper.";
        render();
    }
}

function loadText(value) {
    offers = parseCsv(value);
    fillOptions(elements.site, offers.map((offer) => offer.site));
    fillOptions(elements.contract, offers.map((offer) => offer.contrat));
    applyFilters();
}

elements.file.addEventListener("change", async () => { if (elements.file.files[0]) loadText(await elements.file.files[0].text()); });
$("#load").addEventListener("click", loadLatest);
$("#reset").addEventListener("click", () => { elements.search.value = ""; elements.site.value = ""; elements.contract.value = ""; elements.status.value = "all"; elements.fit.value = "0"; elements.sort.value = config.interface?.defaultSort || "newest"; applyFilters(); });
elements.ignored.addEventListener("input", () => { localStorage.setItem(STORAGE_IGNORED, elements.ignored.value); applyFilters(); });
[elements.site, elements.contract, elements.status, elements.sort, elements.fit, elements.details].forEach((element) => element.addEventListener("change", applyFilters));
let searchFrame;
elements.search.addEventListener("input", () => { cancelAnimationFrame(searchFrame); searchFrame = requestAnimationFrame(applyFilters); });
document.addEventListener("keydown", (event) => { if (event.key === "/" && document.activeElement !== elements.search) { event.preventDefault(); elements.search.focus(); } });
elements.ignored.value = localStorage.getItem(STORAGE_IGNORED) || "";
loadConfig().then(loadLatest);
