const STORAGE_VISITED = "exit-the-cave-visited";
const STORAGE_APPLIED = "exit-the-cave-applied";
const STORAGE_IGNORED = "exit-the-cave-ignored";
const STORAGE_REVIEW = "exit-the-cave-review";
const STORAGE_SENT = "exit-the-cave-sent";
const FALLBACK_CONFIG = {
    filters: { ignoredCompanies: [] },
    profile: { weightedKeywords: [], targetRoles: [], niceToHave: { skills: [], software: [], sectors: [] } },
    interface: { defaultSort: "fit", showDescriptionByDefault: false, showExtraFieldsByDefault: false },
};

let config = FALLBACK_CONFIG;
let offers = [];
let filtered = [];
let visited = readSet(STORAGE_VISITED);
let applied = readSet(STORAGE_APPLIED);
let review = readSet(STORAGE_REVIEW);
let sent = readSet(STORAGE_SENT);
const expandedOffers = new Set();
let collectionRunning = false;
let lastCollectionFinished = null;
let feedbackTimer;

const $ = (selector) => document.querySelector(selector);
const elements = {
    file: $("#file"),
    search: $("#search"),
    ignored: $("#excluded-companies"),
    site: $("#site"),
    contract: $("#contract"),
    status: $("#status-filter"),
    fit: $("#fit-filter"),
    sort: $("#sort"),
    details: $("#detail-mode"),
    load: $("#load"),
    reset: $("#reset"),
    results: $("#results"),
    statusText: $("#status"),
    visible: $("#visible-count"),
    total: $("#total-count"),
    visited: $("#visited-count"),
    feedback: $("#feedback"),
    feedbackIcon: $("#feedback-icon"),
    feedbackText: $("#feedback-text"),
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

function list(value) {
    return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function hideFeedback() {
    clearTimeout(feedbackTimer);
    elements.feedback.hidden = true;
}

function showFeedback(message, tone = "success") {
    clearTimeout(feedbackTimer);
    elements.feedback.className = `feedback ${tone}`;
    elements.feedbackIcon.textContent = tone === "error" ? "!" : tone === "info" ? "↻" : "✓";
    elements.feedbackText.textContent = message;
    elements.feedback.hidden = false;
    feedbackTimer = setTimeout(hideFeedback, 3800);
}

function profileKeywords() {
    const profile = config.profile || {};
    const configured = Array.isArray(profile.weightedKeywords)
        ? profile.weightedKeywords
              .map((item) => ({ term: text(item?.term), weight: Number(item?.weight) }))
              .filter((item) => item.term && Number.isFinite(item.weight) && item.weight > 0)
        : [];
    if (configured.length) return configured;

    const generated = [];
    if (Array.isArray(profile.targetRoles)) {
        profile.targetRoles.forEach((role) => {
            if (text(role?.name)) generated.push({ term: text(role.name), weight: 10 });
            list(role?.synonyms).forEach((term) => generated.push({ term, weight: 9 }));
        });
    }
    list(profile.niceToHave?.skills).forEach((term) => generated.push({ term, weight: 5 }));
    list(profile.niceToHave?.software).forEach((term) => generated.push({ term, weight: 5 }));
    list(profile.niceToHave?.sectors).forEach((term) => generated.push({ term, weight: 4 }));
    list(profile.keywords).forEach((term) => generated.push({ term, weight: 5 }));

    const unique = new Map();
    generated.forEach((item) => {
        const key = normalized(item.term);
        if (key && (!unique.has(key) || item.weight > unique.get(key).weight)) unique.set(key, item);
    });
    return [...unique.values()];
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
        try {
            const extra = JSON.parse(offer.extra || "{}");
            if (extra && typeof extra === "object") {
                offer._extra = extra;
                offer.entreprise ||= text(extra.company);
                offer.localisation ||= text(extra.location);
                offer.contrat ||= text(extra.contract);
                offer.salaire ||= text(extra.salary);
                offer.temps_de_travail ||= text(extra.workTime);
                offer.description ||= text(extra.description);
            }
        } catch {
            offer._extra = {};
        }
        offer._key = offer.lien || `${offer.site}|${offer.intitulé}|${offer.localisation}`;
        offer._search = normalized(Object.entries(offer).filter(([key]) => !key.startsWith("_")).map(([, value]) => value).join(" "));
        offer._date = dateValue(offer.date_publication);
        offer._fit = fitScore(offer);
        return offer;
    });
}

function fitScore(offer) {
    const title = normalized(offer.intitulé);
    const source = offer._search || "";
    const keywords = profileKeywords();
    let score = 0;
    let total = 0;
    keywords.forEach(({ term, weight }) => {
        const keyword = normalized(term);
        total += weight;
        if (source.includes(keyword)) score += title.includes(keyword) ? weight * 1.7 : weight;
    });
    const contract = normalized(offer.contrat);
    const contractScoring = config.profile?.contractScoring || { preferred: ["CDI", "CDD"], avoided: ["Alternance", "Apprentissage", "Stage"] };
    if (list(contractScoring.preferred).some((term) => matchesPhrase(contract, term))) score += 8;
    if (list(contractScoring.avoided).some((term) => matchesPhrase(contract, term))) score -= 35;
    if (!total) return 0;
    return Math.max(0, Math.min(99, Math.round((score / (total * 0.2)) * 100)));
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
    if (!timestamp) return text(value) || "—";
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function ignoredCompanies() {
    const manual = text(elements.ignored.value).split(",").map(normalized).filter(Boolean);
    return [...new Set(manual)];
}

function matchesPhrase(value, term) {
    const phrase = normalized(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Boolean(phrase) && new RegExp(`(?:^|[^a-z0-9])${phrase}(?:$|[^a-z0-9])`).test(normalized(value));
}

function explicitlyExcluded(offer) {
    const exclusions = config.profile?.exclusions || {};
    return list(exclusions.roles).some((term) => matchesPhrase(offer.intitulé, term)) ||
        [...list(exclusions.contracts), ...list(config.filters?.excludedContracts)].some((term) => matchesPhrase(offer.contrat, term)) ||
        list(exclusions.locations).some((term) => matchesPhrase(offer.localisation, term)) ||
        list(config.filters?.excludedBroadLocations).some((term) => normalized(offer.localisation) === normalized(term));
}

function fillOptions(select, values) {
    select.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
    [...new Set(values.filter(Boolean))].sort((first, second) => first.localeCompare(second, "fr")).forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
    });
}

function createCell(value, className = "") {
    const cell = document.createElement("td");
    cell.className = className;
    if (value instanceof Node) cell.append(value);
    else cell.textContent = text(value) || "—";
    return cell;
}

function createRow(offer) {
    const row = document.createElement("tr");
    const isVisited = visited.has(offer._key);
    const isApplied = sent.has(offer._key);
    row.className = `${isVisited ? "visited " : ""}${isApplied ? "applied" : ""}`.trim();

    const score = document.createElement("span");
    score.className = `score ${offer._fit >= 80 ? "high" : offer._fit >= 60 ? "medium" : ""}`;
    score.textContent = `${offer._fit}%`;

    const titleBox = document.createElement("div");
    titleBox.className = "title-box";
    const link = document.createElement("a");
    link.href = offer.lien || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = offer.intitulé || "Offre sans intitulé";
    link.addEventListener("click", () => {
        visited.add(offer._key);
        saveSet(STORAGE_VISITED, visited);
        applyFilters(false);
        showFeedback(`Offre ouverte : ${offer.intitulé || "sans intitulé"}`);
    });
    const tags = document.createElement("div");
    tags.className = "row-tags";
    [offer.site, offer.salaire, offer.temps_de_travail].filter(Boolean).forEach((value) => {
        const tag = document.createElement("span");
        tag.textContent = value;
        tags.append(tag);
    });
    if (isVisited) {
        const opened = document.createElement("span");
        opened.className = "opened";
        opened.textContent = "✓ ouverte";
        tags.prepend(opened);
    }
    titleBox.append(link, tags);
    const details = document.createElement("details");
    details.className = "offer-details";
    details.open = expandedOffers.has(offer._key) || elements.details.value === "all";
    const summary = document.createElement("summary");
    summary.textContent = "Voir les détails";
    details.append(summary);
    {
        const description = document.createElement("p");
        description.textContent = offer.description || "Description non disponible dans cette collecte. Ouvre l’annonce pour la consulter.";
        details.append(description);
    }
    details.addEventListener("toggle", () => {
        if (!details.isConnected) return;
        details.open ? expandedOffers.add(offer._key) : expandedOffers.delete(offer._key);
        summary.textContent = details.open ? "Masquer les détails" : "Voir les détails";
    });
    titleBox.append(details);

    const tracking = document.createElement("select");
    tracking.className = "tracking";
    tracking.setAttribute("aria-label", `Suivi de ${offer.intitulé}`);
    [["none", "À traiter"], ["review", "À revoir"], ["sent", "Candidature envoyée"], ["legacy", "Traitée (ancien suivi)"]].forEach(([value, label]) => {
        const option = document.createElement("option"); option.value = value; option.textContent = label;
        if (value !== "legacy" || applied.has(offer._key)) tracking.append(option);
    });
    tracking.value = isApplied ? "sent" : review.has(offer._key) ? "review" : applied.has(offer._key) ? "legacy" : "none";
    tracking.addEventListener("change", () => {
        const message = tracking.selectedOptions[0].textContent;
        sent.delete(offer._key); review.delete(offer._key); applied.delete(offer._key);
        if (tracking.value === "sent") sent.add(offer._key);
        if (tracking.value === "review") review.add(offer._key);
        if (tracking.value === "legacy") applied.add(offer._key);
        saveSet(STORAGE_SENT, sent); saveSet(STORAGE_REVIEW, review); saveSet(STORAGE_APPLIED, applied);
        applyFilters(false);
        showFeedback(`${message} · suivi enregistré.`);
    });

    row.append(
        createCell(score, "score-cell"),
        createCell(titleBox, "offer-cell"),
        createCell(offer.entreprise),
        createCell(offer.localisation),
        createCell(offer.contrat),
        createCell(displayDate(offer.date_publication)),
        createCell(tracking, "tracking-cell"),
    );
    return row;
}

function render() {
    const fragment = document.createDocumentFragment();
    filtered.forEach((offer) => fragment.append(createRow(offer)));
    elements.results.replaceChildren(fragment);
    if (!filtered.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 7;
        cell.className = "empty";
        cell.textContent = offers.length ? "Aucune offre avec ces filtres." : "Aucune offre locale. Lance la collecte puis actualise.";
        row.append(cell);
        elements.results.append(row);
    }
    elements.visible.textContent = filtered.length.toLocaleString("fr-FR");
    elements.total.textContent = offers.length.toLocaleString("fr-FR");
    elements.visited.textContent = offers.filter((offer) => visited.has(offer._key)).length.toLocaleString("fr-FR");
    elements.statusText.textContent = `${filtered.length.toLocaleString("fr-FR")} offre${filtered.length > 1 ? "s" : ""} affichée${filtered.length > 1 ? "s" : ""} sur ${offers.length.toLocaleString("fr-FR")}.`;
}

function applyFilters(scrollToTop = true) {
    const query = normalized(elements.search.value);
    const ignored = ignoredCompanies();
    const minimum = Number(elements.fit.value) || 0;
    filtered = offers.filter((offer) => {
        const isVisited = visited.has(offer._key);
        const isApplied = applied.has(offer._key);
        return (!query || offer._search.includes(query)) &&
            !explicitlyExcluded(offer) &&
            !ignored.some((company) => normalized(offer.entreprise).includes(company)) &&
            (!elements.site.value || offer.site === elements.site.value) &&
            (!elements.contract.value || offer.contrat === elements.contract.value) &&
            offer._fit >= minimum &&
            (elements.status.value === "all" ||
                (elements.status.value === "visited" && isVisited) ||
                (elements.status.value === "unvisited" && !isVisited) ||
                (elements.status.value === "review" && review.has(offer._key)) ||
                (elements.status.value === "sent" && sent.has(offer._key)) ||
                (elements.status.value === "applied" && isApplied));
    });
    filtered.sort((first, second) => {
        if (elements.sort.value === "fit") return second._fit - first._fit || second._date - first._date;
        const difference = second._date - first._date;
        return elements.sort.value === "newest" ? difference : -difference;
    });
    render();
    if (scrollToTop) $(".table-scroll").scrollTop = 0;
}

function loadText(value) {
    offers = parseCsv(value);
    fillOptions(elements.site, offers.map((offer) => offer.site));
    fillOptions(elements.contract, offers.map((offer) => offer.contrat));
    applyFilters();
}

async function loadConfig() {
    try {
        const response = await fetch("data/config.json", { cache: "no-store" });
        if (!response.ok) throw new Error("configuration absente");
        const loaded = await response.json();
        config = {
            ...FALLBACK_CONFIG,
            ...loaded,
            filters: { ...FALLBACK_CONFIG.filters, ...loaded.filters },
            profile: { ...FALLBACK_CONFIG.profile, ...loaded.profile },
            interface: { ...FALLBACK_CONFIG.interface, ...loaded.interface },
        };
        const keywords = profileKeywords();
        $("#config-state").textContent = `Configuration · ${config.location?.city || "locale"}`;
        $("#profile-summary").textContent = `Profil actif · ${keywords.length} mots-clés pondérés`;
        $("#profile-detail").textContent = keywords.map(({ term, weight }) => `${term} (${weight})`).join(" · ");
        elements.ignored.value = localStorage.getItem(STORAGE_IGNORED) ?? [...new Set([
            ...list(config.filters?.ignoredCompanies), ...list(config.profile?.exclusions?.companies),
        ])].join(", ");
        elements.sort.value = ["fit", "newest", "oldest"].includes(config.interface?.defaultSort) ? config.interface.defaultSort : "fit";
        elements.details.value = config.interface?.showDescriptionByDefault ? "all" : "compact";
    } catch {
        $("#config-state").textContent = "Configuration par défaut";
        $("#profile-summary").textContent = "Aucun profil pondéré";
        $("#profile-detail").textContent = "Ajoute des mots-clés dans data/config.json.";
    }
}

async function loadLatest(announce = false) {
    elements.load.disabled = true;
    elements.load.textContent = "↻ Chargement…";
    try {
        const response = await fetch("data/latest/jobs.csv", { cache: "no-store" });
        if (!response.ok) throw new Error("résultat absent");
        loadText(await response.text());
        if (announce) showFeedback(`${offers.length.toLocaleString("fr-FR")} offres chargées.`);
    } catch {
        render();
        elements.statusText.textContent = "Résultat local indisponible. Lance la collecte ou importe un CSV.";
        if (announce) showFeedback("Impossible de charger les offres.", "error");
    } finally {
        elements.load.disabled = false;
        elements.load.textContent = "Recharger les résultats";
    }
}

elements.file.addEventListener("change", async () => {
    const file = elements.file.files[0];
    if (!file) return;
    loadText(await file.text());
    showFeedback(`${file.name} importé · ${offers.length.toLocaleString("fr-FR")} offres.`);
});
elements.load.addEventListener("click", async () => { await loadConfig(); await loadLatest(true); await refreshCollection(); });
elements.reset.addEventListener("click", () => {
    elements.search.value = "";
    elements.site.value = "";
    elements.contract.value = "";
    elements.status.value = "all";
    elements.fit.value = "0";
    elements.sort.value = "fit";
    applyFilters();
    showFeedback("Filtres réinitialisés.");
});
elements.ignored.addEventListener("input", () => {
    localStorage.setItem(STORAGE_IGNORED, elements.ignored.value);
    applyFilters();
});
[elements.site, elements.contract, elements.status, elements.fit, elements.sort, elements.details].forEach((element) =>
    element.addEventListener("change", () => {
        applyFilters();
        showFeedback(`${element.getAttribute("aria-label") || "Affichage"} : ${element.selectedOptions[0]?.textContent || ""}`, "info");
    }),
);
let searchFrame;
elements.search.addEventListener("input", () => {
    cancelAnimationFrame(searchFrame);
    searchFrame = requestAnimationFrame(() => applyFilters());
});
$("#feedback-close").addEventListener("click", hideFeedback);
document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== elements.search) {
        event.preventDefault();
        elements.search.focus();
    }
});

elements.ignored.value = localStorage.getItem(STORAGE_IGNORED) || "";
loadConfig().then(async () => { await loadLatest(); await refreshCollection(); });

const sourceNames = { franceTravail: "France Travail", hellowork: "HelloWork", meteojob: "Meteojob", linkedin: "LinkedIn", apec: "Apec", cadremploi: "Cadremploi", glassdoor: "Glassdoor", jobijoba: "Jobijoba" };
const stateLabels = { running: "En cours", completed: "Terminée", partial: "Partielle", login_required: "Connexion requise", error: "Erreur", disabled: "Désactivée", interrupted: "Interrompue" };

async function refreshCollection() {
    try {
        const response = await fetch("/api/collection", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const status = await response.json();
        const previouslyRunning = collectionRunning;
        collectionRunning = status.running;
        $("#collect").disabled = collectionRunning;
        $("#collect").textContent = collectionRunning ? "Collecte en cours…" : "Lancer une collecte";
        const report = status.report;
        $("#collection-summary").textContent = status.error || (collectionRunning ? "Collecte en cours · voir les sources" : report ? `Collecte ${stateLabels[report.state]?.toLowerCase() || "inconnue"} · voir les sources` : "Sources · état inconnu pour cette ancienne collecte");
        const time = report?.finishedAt || report?.startedAt;
        $("#collection-date").textContent = time ? `${report.finishedAt ? "Dernière collecte" : "Collecte démarrée"} : ${displayDate(time)}` : "Date de collecte non disponible";
        if (!time) {
            const metadata = await fetch("data/latest/jobs.json", { cache: "no-store" });
            if (metadata.ok) { const data = await metadata.json(); if (data.generatedAt) $("#collection-date").textContent = `Résultats du ${displayDate(data.generatedAt)}`; }
        }
        const rows = document.createDocumentFragment();
        for (const [name, source] of Object.entries(report?.sources || {})) {
            const row = document.createElement("li");
            const state = !collectionRunning && source.state === "running" ? "interrupted" : source.state;
            row.textContent = `${sourceNames[name] || name} · ${stateLabels[state] || "État inconnu"} · ${source.collected} récupérées${source.newOffers === undefined ? "" : ` · ${source.newOffers} nouvelles`} · ${source.pages} page(s). ${source.reason}`;
            rows.append(row);
        }
        $("#collection-sources").replaceChildren(rows);
        if (previouslyRunning && !collectionRunning && report?.finishedAt && report.finishedAt !== lastCollectionFinished) {
            await loadLatest(); showFeedback("Collecte arrêtée. Résultats rechargés ; consulte l’état des sources.", "info");
        }
        lastCollectionFinished = report?.finishedAt;
    } catch { $("#collection-summary").textContent = "État de collecte indisponible"; }
}

$("#collect").addEventListener("click", async () => {
    $("#collect").disabled = true;
    $("#collect").textContent = "Démarrage…";
    try {
        const response = await fetch("/api/collection", { method: "POST", headers: { "X-Collection-Request": "1" } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Démarrage impossible");
        collectionRunning = true;
        showFeedback("Collecte lancée. LinkedIn peut demander une connexion dans sa fenêtre.", "info");
    } catch (error) {
        showFeedback(error.message, "error");
        $("#collect").disabled = false;
        $("#collect").textContent = "Lancer une collecte";
    }
    await refreshCollection();
});
setInterval(refreshCollection, 3000);
