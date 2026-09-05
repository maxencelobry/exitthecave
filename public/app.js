const STORAGE_VISITED = "exit-the-cave-visited";
const STORAGE_APPLIED = "exit-the-cave-applied";
const STORAGE_IGNORED = "exit-the-cave-ignored";
const FALLBACK_CONFIG = {
    filters: { excludedBroadLocations: [], excludedContracts: [], ignoredCompanies: [] },
    profile: {
        targetTitles: [], keywords: [], skills: [], languages: [], experience: [], education: [], contracts: [], workPreferences: [],
        targetRoles: [],
        mustHave: { skills: [], contracts: [], languages: [], education: [], experience: [] },
        niceToHave: { skills: [], software: [], sectors: [] },
        exclusions: { roles: [], contracts: [], locations: [], companies: [] },
        preferences: { remote: [], salaryMinimum: null, workTime: [], maximumDistanceKm: null },
    },
    interface: { defaultSort: "fit", showDescriptionByDefault: false, showExtraFieldsByDefault: true },
};

let config = FALLBACK_CONFIG;
let offers = [];
let filtered = [];
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
        try {
            const extra = JSON.parse(offer.extra || "{}");
            if (extra && typeof extra === "object") {
                offer._extra = extra;
                offer.teletravail ||= text(extra.remote || extra.telework || extra.teletravail);
                offer.experience ||= text(extra.experience || extra.experienceLevel);
                offer.competences ||= array(extra.skills || extra.competences).join(" | ");
                offer.fiabilite ||= text(extra.reliabilityScore);
            }
        } catch {
            offer._extra = {};
        }
        offer._key = text(offer.lien) || `${offer.site}|${offer.intitulé}|${offer.localisation}`;
        offer._search = Object.values(offer).join(" ").toLocaleLowerCase("fr");
        offer._date = dateValue(offer.date_publication);
        const match = compatibility(offer);
        offer._fit = match.overall;
        offer._match = match;
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
    ["employe", "agent"],
    ["employee", "agent"],
    ["chargee", "charge"],
    ["coordinateur", "coordination"],
    ["coordinatrice", "coordination"],
    ["commerciale", "commercial"],
    ["vendeuse", "vente"],
    ["vendeur", "vente"],
    ["comptable", "comptabilite"],
    ["rh", "ressource-humaine"],
    ["teletravail", "distance"],
    ["remote", "distance"],
]);

function tokens(value) {
    return normalized(value)
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .map((token) => TOKEN_ALIASES.get(token) || token)
        .map((token) => token.replace(/(euses|eurs|euse|eur|iennes|iens|ienne|ien|ives|ifs|ive|if|es|s)$/u, ""))
        .filter((token) => token.length > 2);
}

function termCoverage(term, haystack, haystackTokens) {
    const phrase = normalized(term);
    if (!phrase) return 0;
    if (haystack.includes(phrase)) return 1;
    const wanted = tokens(term);
    if (!wanted.length) return 0;
    const matches = wanted.filter((wantedToken) =>
        haystackTokens.some((candidate) => candidate === wantedToken || (wantedToken.length > 5 && candidate.startsWith(wantedToken.slice(0, 5)))),
    );
    return matches.length / wanted.length;
}

function termMatches(term, haystack, haystackTokens) {
    return termCoverage(term, haystack, haystackTokens) >= (tokens(term).length > 1 ? 0.67 : 1);
}

function profileModel() {
    const profile = config.profile || FALLBACK_CONFIG.profile;
    const configuredRoles = Array.isArray(profile.targetRoles) ? profile.targetRoles : [];
    const roles = configuredRoles
        .filter((role) => role && typeof role === "object" && text(role.name))
        .map((role) => ({ name: text(role.name), synonyms: array(role.synonyms), priority: role.priority === "nice_to_have" ? "nice_to_have" : "must_have" }));
    if (!roles.length) array(profile.targetTitles).forEach((name) => roles.push({ name, synonyms: [], priority: "must_have" }));
    return {
        roles,
        mustHave: {
            skills: array(profile.mustHave?.skills),
            contracts: array(profile.mustHave?.contracts).length ? array(profile.mustHave.contracts) : array(profile.contracts),
            languages: array(profile.mustHave?.languages),
            education: array(profile.mustHave?.education),
            experience: array(profile.mustHave?.experience),
        },
        niceToHave: {
            skills: [...array(profile.niceToHave?.skills), ...array(profile.skills), ...array(profile.languages), ...array(profile.education), ...array(profile.experience), ...array(profile.keywords)],
            software: array(profile.niceToHave?.software),
            sectors: array(profile.niceToHave?.sectors),
        },
        exclusions: {
            roles: array(profile.exclusions?.roles),
            contracts: [...array(profile.exclusions?.contracts), ...array(config.filters?.excludedContracts)],
            locations: [...array(profile.exclusions?.locations), ...array(config.filters?.excludedBroadLocations)],
            companies: [...array(profile.exclusions?.companies), ...array(config.filters?.ignoredCompanies)],
        },
        preferences: {
            remote: array(profile.preferences?.remote),
            salaryMinimum: Number(profile.preferences?.salaryMinimum) || null,
            workTime: array(profile.preferences?.workTime).length ? array(profile.preferences.workTime) : array(profile.workPreferences),
            maximumDistanceKm: Number(profile.preferences?.maximumDistanceKm) || Number(config.location?.radiusKm) || null,
        },
    };
}

function criteriaScore(criteria, haystack, label, required, matchedCriteria, missingCriteria) {
    if (!criteria.length) return 100;
    const haystackTokens = tokens(haystack);
    let matches = 0;
    criteria.forEach((criterion) => {
        if (termMatches(criterion, haystack, haystackTokens)) {
            matches += 1;
            matchedCriteria.push(`${label} : ${criterion}`);
        } else if (required) missingCriteria.push(`${label} requis : ${criterion}`);
    });
    const expectedMatches = required ? criteria.length : Math.min(criteria.length, 4);
    return Math.round(Math.min(1, matches / expectedMatches) * 100);
}

function salaryMinimum(value) {
    const source = normalized(value).replace(/\s/g, "");
    const values = [...source.matchAll(/(\d+(?:[.,]\d+)?)\s*(k)?\s*(?:€|eur)/g)].map((match) => Number(match[1].replace(",", ".")) * (match[2] ? 1000 : 1));
    if (!values.length) return null;
    const amount = Math.min(...values);
    if (/mois|mensuel/.test(source)) return amount * 12;
    if (/heure|horaire/.test(source)) return amount * 151.67 * 12;
    return amount;
}

function compatibility(offer) {
    const profile = profileModel();
    const matchedCriteria = [];
    const missingCriteria = [];
    const warnings = [];
    const title = normalized(offer.intitulé);
    const titleTokens = tokens(title);
    const roleMatches = profile.roles.map((role) => {
        const terms = [role.name, ...role.synonyms];
        return { role, coverage: Math.max(...terms.map((term) => termCoverage(term, title, titleTokens))) };
    });
    const bestRole = roleMatches.sort((a, b) => b.coverage - a.coverage)[0];
    const bestRequiredRole = roleMatches.filter(({ role }) => role.priority === "must_have").sort((a, b) => b.coverage - a.coverage)[0];
    const requiredRoleSatisfied = !bestRequiredRole || bestRequiredRole.coverage >= 0.67;
    const roleMatch = bestRole ? Math.round(Math.min(1, bestRole.coverage) * 100) : 50;
    if (bestRole?.coverage >= 0.67) matchedCriteria.push(`métier : ${bestRole.role.name}`);
    if (!requiredRoleSatisfied) missingCriteria.push("métier obligatoire absent de l’intitulé");

    const skillText = [offer.intitulé, offer.competences, offer.description].join(" ");
    const requiredSkills = [...profile.mustHave.skills, ...profile.mustHave.languages, ...profile.mustHave.education];
    const requiredSkillScore = criteriaScore(requiredSkills, skillText, "critère", true, matchedCriteria, missingCriteria);
    const bonusSkills = [...profile.niceToHave.skills, ...profile.niceToHave.software, ...profile.niceToHave.sectors];
    const bonusSkillScore = criteriaScore(bonusSkills, skillText, "bonus", false, matchedCriteria, missingCriteria);
    const skillsMatch = requiredSkills.length ? Math.round(requiredSkillScore * 0.8 + bonusSkillScore * 0.2) : bonusSkills.length ? bonusSkillScore : 100;

    const contract = normalized(offer.contrat);
    const wantedContracts = profile.mustHave.contracts;
    const contractMatch = !wantedContracts.length ? 100 : !contract ? 45 : wantedContracts.some((wanted) => termMatches(wanted, contract, tokens(contract))) ? 100 : 0;
    if (contractMatch === 100 && wantedContracts.length) matchedCriteria.push(`contrat : ${offer.contrat}`);
    else if (contractMatch === 0) missingCriteria.push(`contrat incompatible : ${offer.contrat}`);
    else if (contractMatch === 45) warnings.push("contrat non renseigné");

    const location = normalized(offer.localisation);
    const city = text(config.location?.city);
    const distance = location.match(/(?:a|à)\s*(\d+)\s*km/)?.[1];
    const tooFar = distance && profile.preferences.maximumDistanceKm && Number(distance) > profile.preferences.maximumDistanceKm;
    let locationMatch = !location ? 55 : city && termMatches(city, location, tokens(location)) ? 100 : 75;
    if (tooFar) locationMatch = 0;
    if (!location) warnings.push("localisation non renseignée");
    else if (locationMatch === 100) matchedCriteria.push(`localisation : ${city}`);
    else if (tooFar) missingCriteria.push(`distance supérieure à ${profile.preferences.maximumDistanceKm} km`);
    else if (city) warnings.push("distance exacte non vérifiable depuis le texte de l’offre");

    const experienceText = [offer.experience, offer.description].join(" ");
    const experienceMatch = profile.mustHave.experience.length
        ? criteriaScore(profile.mustHave.experience, experienceText, "expérience", true, matchedCriteria, missingCriteria)
        : offer.experience ? 100 : 70;

    const remoteText = normalized([offer.teletravail, offer.description].join(" "));
    if (profile.preferences.remote.length && !profile.preferences.remote.some((value) => termMatches(value, remoteText, tokens(remoteText)))) warnings.push("préférence de télétravail non confirmée");
    const workTimeText = normalized([offer.temps_de_travail, offer.description].join(" "));
    if (profile.preferences.workTime.length && !profile.preferences.workTime.some((value) => termMatches(value, workTimeText, tokens(workTimeText)))) warnings.push("temps de travail non confirmé");

    const offeredSalary = salaryMinimum(offer.salaire);
    if (profile.preferences.salaryMinimum && offeredSalary && offeredSalary < profile.preferences.salaryMinimum) missingCriteria.push(`salaire inférieur à ${profile.preferences.salaryMinimum.toLocaleString("fr-FR")} €`);
    else if (profile.preferences.salaryMinimum && !offeredSalary) warnings.push("salaire non renseigné");
    else if (profile.preferences.salaryMinimum && offeredSalary) matchedCriteria.push("salaire minimum respecté");

    const excluded = [
        [profile.exclusions.roles, title, "métier exclu"],
        [profile.exclusions.contracts, contract, "contrat exclu"],
        [profile.exclusions.locations, location, "localisation exclue"],
        [profile.exclusions.companies, normalized(offer.entreprise), "entreprise exclue"],
    ].find(([values, target]) => values.some((value) => termMatches(value, target, tokens(target))));
    if (excluded) missingCriteria.push(excluded[2]);

    const reliability = Number(offer.fiabilite || offer._extra?.reliabilityScore);
    const available = [offer.entreprise, offer.localisation, offer.contrat, offer.description, offer.date_publication, offer.competences || offer._extra?.skills].filter(Boolean).length;
    const confidence = Math.round((available / 6) * 70 + (Number.isFinite(reliability) ? reliability * 0.3 : 15));
    let overall = Math.round(roleMatch * 0.4 + skillsMatch * 0.25 + contractMatch * 0.15 + locationMatch * 0.12 + experienceMatch * 0.08);
    if (bestRequiredRole && bestRequiredRole.coverage < 0.5) overall = Math.min(overall, 39);
    if (contractMatch === 0 || locationMatch === 0 || excluded) overall = Math.min(overall, 24);
    if (requiredSkills.length && requiredSkillScore === 0) overall = Math.min(overall, 49);
    const trulyCompatible = overall >= 75 && roleMatch >= 67 && requiredRoleSatisfied && contractMatch === 100 && locationMatch > 0 && !excluded && !missingCriteria.some((value) => value.startsWith("critère requis"));
    return { overall, roleMatch, skillsMatch, contractMatch, locationMatch, experienceMatch, confidence, matchedCriteria, missingCriteria, warnings, trulyCompatible };
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
            (!elements.fit.value ||
                (elements.fit.value === "related"
                    ? offer._match.roleMatch >= 34 || offer._match.skillsMatch >= 25
                    : elements.fit.value === "strict"
                        ? offer._match.trulyCompatible
                        : offer._fit >= Number(elements.fit.value))) &&
            (!ignored.some((company) => normalized(offer.entreprise).includes(company))) &&
            (!excludedLocations.some((value) => value && location.includes(value))) &&
            (!excludedContracts.some((value) => value && contract.includes(value))) &&
            (elements.status.value === "all" || (elements.status.value === "visited" && isVisited) || (elements.status.value === "unvisited" && !isVisited) || (elements.status.value === "applied" && isApplied));
    });
    filtered.sort((a, b) => elements.sort.value === "newest" ? b._date - a._date : elements.sort.value === "oldest" ? a._date - b._date : b._fit - a._fit || b._date - a._date);
    render();
}

function verdict(match) {
    if (match.trulyCompatible || match.overall >= 80) return "Très proche";
    if (match.overall >= 60) return "À regarder";
    if (match.overall >= 40) return "À vérifier";
    return "Hors cible";
}

function createCard(offer) {
    const card = document.createElement("article");
    const fitClass = offer._fit >= 80 ? "fit-high" : offer._fit >= 60 ? "fit-medium" : "fit-low";
    card.className = `job-card ${fitClass}${visited.has(offer._key) ? " visited" : ""}`;
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
    offer._match.matchedCriteria.slice(0, 4).forEach((value) => { const reason = document.createElement("span"); reason.className = "reason"; reason.textContent = `✓ ${value}`; reasons.append(reason); });
    offer._match.missingCriteria.slice(0, 2).forEach((value) => { const reason = document.createElement("span"); reason.className = "reason missing"; reason.textContent = `À vérifier · ${value}`; reasons.append(reason); });
    main.append(reasons);
    if (elements.details.value !== "compact") {
        const explanation = document.createElement("details");
        explanation.className = "match-details";
        const summary = document.createElement("summary");
        summary.textContent = "Comprendre ce score";
        const scoreGrid = document.createElement("div");
        scoreGrid.className = "score-grid";
        [
            ["Métier", offer._match.roleMatch],
            ["Compétences", offer._match.skillsMatch],
            ["Contrat", offer._match.contractMatch],
            ["Lieu", offer._match.locationMatch],
            ["Expérience", offer._match.experienceMatch],
            ["Confiance", offer._match.confidence],
        ].forEach(([name, value]) => {
            const item = document.createElement("span");
            item.innerHTML = `<small>${name}</small><strong>${value}%</strong>`;
            scoreGrid.append(item);
        });
        explanation.append(summary, scoreGrid);
        if (offer._match.warnings.length) {
            const warning = document.createElement("p");
            warning.className = "match-warnings";
            warning.textContent = `Données à confirmer : ${offer._match.warnings.join(" · ")}`;
            explanation.append(warning);
        }
        main.append(explanation);
    }
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
    const matchVerdict = document.createElement("span");
    matchVerdict.className = "match-verdict";
    matchVerdict.textContent = verdict(offer._match);
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
    const confidence = document.createElement("span");
    confidence.className = "match-confidence";
    confidence.textContent = `confiance ${offer._match.confidence}%`;
    match.append(matchVerdict, score, label, bar, confidence);
    card.append(main, match);
    return card;
}

function render() {
    elements.results.replaceChildren();
    const fragment = document.createDocumentFragment();
    filtered.forEach((offer) => fragment.append(createCard(offer)));
    elements.results.append(fragment);
    if (!filtered.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = offers.length ? "Aucune offre ne correspond à ces critères." : "Aucun résultat local. Lance le scraper puis recharge la page."; elements.results.append(empty); }
    elements.visible.textContent = filtered.length.toLocaleString("fr-FR");
    elements.total.textContent = offers.length.toLocaleString("fr-FR");
    elements.visited.textContent = offers.filter((offer) => visited.has(offer._key)).length.toLocaleString("fr-FR");
    const strictCount = offers.filter((offer) => offer._match.trulyCompatible).length;
    elements.statusText.textContent = `${filtered.length.toLocaleString("fr-FR")} affichées en continu · ${strictCount.toLocaleString("fr-FR")} vraiment compatibles détectées`;
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
        $("#config-state").textContent = `Configuration · ${config.location?.city || "locale"}`;
        $("#search-summary").textContent = `Toutes les offres en rapport avec ton parcours autour de ${config.location?.city || "ton secteur"}, sans filtrer selon tes chances.`;
        const model = profileModel();
        $("#profile-summary").textContent = `${model.roles.length} familles de métiers suivies · profil CV actif`;
        $("#profile-detail").textContent = `${model.mustHave.skills.length + model.mustHave.languages.length + model.niceToHave.skills.length + model.niceToHave.software.length} signaux servent uniquement à classer, pas à éliminer.`;
        elements.ignored.value = [...new Set([...array(config.filters?.ignoredCompanies), ...model.exclusions.companies])].join(", ");
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
$("#reset").addEventListener("click", () => { elements.search.value = ""; elements.site.value = ""; elements.contract.value = ""; elements.status.value = "all"; elements.fit.value = "related"; elements.sort.value = config.interface?.defaultSort || "newest"; applyFilters(); });
elements.ignored.addEventListener("input", () => { localStorage.setItem(STORAGE_IGNORED, elements.ignored.value); applyFilters(); });
[elements.site, elements.contract, elements.status, elements.sort, elements.fit, elements.details].forEach((element) => element.addEventListener("change", applyFilters));
let searchFrame;
elements.search.addEventListener("input", () => { cancelAnimationFrame(searchFrame); searchFrame = requestAnimationFrame(applyFilters); });
document.addEventListener("keydown", (event) => { if (event.key === "/" && document.activeElement !== elements.search) { event.preventDefault(); elements.search.focus(); } });
elements.ignored.value = localStorage.getItem(STORAGE_IGNORED) || "";
loadConfig().then(loadLatest);
