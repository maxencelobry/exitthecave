import { readFile } from "node:fs/promises";
import { searchConfig } from "../../config.js";

const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";
const API_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
const PAGE_SIZE = 150;
export type FranceTravailApiOptions = {
    locationCode?: string | undefined;
    radiusKm?: number | undefined;
    limit?: number | undefined;
};

function isoWithoutMilliseconds(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

type Credentials = {
    "Identifiant client"?: unknown;
    "Clé secrète"?: unknown;
};

type ApiOffer = {
    id?: string;
    intitule?: string;
    description?: string;
    dateCreation?: string;
    lieuTravail?: { libelle?: string; codePostal?: string; commune?: string };
    entreprise?: { nom?: string };
    typeContratLibelle?: string;
    dureeTravailLibelle?: string;
    salaire?: { libelle?: string; commentaire?: string };
    experienceLibelle?: string;
    formations?: Array<{ libelle?: string }>;
    competences?: Array<{ libelle?: string }>;
    origineOffre?: { urlOrigine?: string };
};

export interface FranceTravailApiResult {
    title: string;
    url: string;
    extra: {
        company: string | null;
        location: string | null;
        contract: string | null;
        workTime: string | null;
        salary: string | null;
        publishedAt: string | null;
        description: string | null;
        visibleInfo: string[];
    };
}

export class FranceTravailApiScrapper {
    async scrap(options: FranceTravailApiOptions = {}): Promise<FranceTravailApiResult[]> {
        try {
            const credentials = await this.loadCredentials();
            if (!credentials) {
                this.logError(
                    "Identifiants API absents",
                        "Configure franceTravail.credentialsFile dans src/config.ts",
                );
                return [];
            }

            const token = await this.getToken(credentials);
            const results: FranceTravailApiResult[] = [];
            const minCreationDate = isoWithoutMilliseconds(new Date(Date.now() - 24 * 60 * 60 * 1000));
            const maxCreationDate = isoWithoutMilliseconds(new Date());
            const locationCode = options.locationCode ?? searchConfig.franceTravail.locationCode;
            const radiusKm = options.radiusKm ?? searchConfig.franceTravail.radiusKm;
            const limit = Math.min(Math.max(options.limit ?? 10_000, 1), 10_000);
            let total = 0;

            for (let start = 0; start < limit; start += PAGE_SIZE) {
                const params = new URLSearchParams({
                    commune: locationCode,
                    distance: String(radiusKm),
                    minCreationDate,
                    maxCreationDate,
                    range: `${start}-${Math.min(start + PAGE_SIZE - 1, limit - 1)}`,
                    sort: "1",
                });
                const response = await fetch(`${API_URL}?${params}`, {
                    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
                });
                if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
                const payload = (await response.json()) as { resultats?: ApiOffer[] };
                const batch = (payload.resultats ?? []).slice(0, limit - results.length);
                if (start === 0) {
                    total = Number(response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1] ?? 0);
                    this.log(`Résultat API affiché : ${total || "inconnu"} offre(s)`);
                }
                results.push(...batch.map((offer) => this.mapOffer(offer)).filter((offer) => offer.title && offer.url));
                this.log(`API ${start + 1}-${start + batch.length} : ${results.length} offre(s)`);
                if (batch.length < PAGE_SIZE || (total > 0 && results.length >= total)) break;
            }

            this.log(`${results.length} offre(s) trouvée(s) via API`);
            return results;
        } catch (error) {
            this.logError("La collecte API a rencontré une erreur", error);
            return [];
        }
    }

    private async loadCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
        const filePath = searchConfig.franceTravail.credentialsFile;
        if (!filePath) return null;

        const credentials = JSON.parse(await readFile(filePath, "utf8")) as Credentials;
        const fileClientId = credentials["Identifiant client"];
        const fileClientSecret = credentials["Clé secrète"];
        return typeof fileClientId === "string" && typeof fileClientSecret === "string"
            ? { clientId: fileClientId, clientSecret: fileClientSecret }
            : null;
    }

    private async getToken(credentials: { clientId: string; clientSecret: string }): Promise<string> {
        const response = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
                scope: "api_offresdemploiv2 o2dsoffre",
            }),
        });
        if (!response.ok) throw new Error(`Token HTTP ${response.status}`);
        const payload = (await response.json()) as { access_token?: string };
        if (!payload.access_token) throw new Error("Token absent de la réponse");
        return payload.access_token;
    }

    private mapOffer(offer: ApiOffer): FranceTravailApiResult {
        const location = offer.lieuTravail?.libelle ?? offer.lieuTravail?.commune ?? null;
        const salary = offer.salaire?.libelle ?? offer.salaire?.commentaire ?? null;
        const visibleInfo = [
            offer.entreprise?.nom,
            location,
            offer.typeContratLibelle,
            offer.dureeTravailLibelle,
            salary,
            offer.experienceLibelle,
            ...(offer.formations ?? []).map((item) => item.libelle),
            ...(offer.competences ?? []).map((item) => item.libelle),
            offer.dateCreation,
            offer.description,
        ].filter((value): value is string => Boolean(value));
        return {
            title: offer.intitule ?? "",
            url: `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id ?? ""}`,
            extra: {
                company: offer.entreprise?.nom ?? null,
                location,
                contract: offer.typeContratLibelle ?? null,
                workTime: offer.dureeTravailLibelle ?? null,
                salary,
                publishedAt: offer.dateCreation ?? null,
                description: offer.description ?? null,
                visibleInfo,
            },
        };
    }

    private log(message: string): void {
        console.log(`[France Travail API] ${message}`);
    }

    private logError(message: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[France Travail API] ${message} : ${detail}`);
    }
}
