import { z } from "zod";

/**
 * Schemas de validation des sorties de modele.
 *
 * Deux garde-fous se superposent, et ce n'est pas une redondance inutile :
 *
 * - `SCHEMA_JSON_EXTRACTION` est envoye au service en mode strict. Il garantit
 *   la FORME : le service ne peut pas renvoyer un champ manquant ou un type
 *   inattendu.
 * - `schemaSortieExtraction` valide la meme sortie avec zod, cote application.
 *   Il garantit ce que le service ne garantit pas : le CONTENU, et le fait que
 *   la forme promise soit bien celle recue.
 *
 * Les deux sont ecrits a la main et gardes cote a cote volontairement : un test
 * unitaire verifie qu'un meme echantillon passe les deux.
 */

export const TYPES_EXIGENCE = ["obligatoire", "optionnelle", "eliminatoire"] as const;

export const CATEGORIES_EXIGENCE = [
  "administratif",
  "financier",
  "technique",
  "equipe",
  "delai",
] as const;

export const KINDS_FAIT = [
  "chiffre_affaires_min",
  "effectif_min",
  "certification_requise",
  "references_min",
  "profil_equipe",
  "attestation_requise",
  "note_technique_min",
] as const;

/**
 * Fait tel que le modele le renvoie : une forme plate, dont toutes les valeurs
 * chiffrees sont des CHAINES recopiees du document ("soixante", "12 778 000.00").
 * Regle 8 du CLAUDE.md : le modele ne produit aucun nombre, c'est
 * normaliserNombre qui convertit.
 */
export const schemaFaitBrut = z.object({
  kind: z.enum(KINDS_FAIT),
  valeurBrute: z.string().nullable(),
  surBrute: z.string().nullable(),
  nomBrut: z.string().nullable(),
  nombreBrut: z.string().nullable(),
  secteurBrut: z.string().nullable(),
  anneesMaxBrut: z.string().nullable(),
  posteBrut: z.string().nullable(),
  experienceMinBrut: z.string().nullable(),
});

export type FaitBrut = z.infer<typeof schemaFaitBrut>;

export const schemaExigenceBrute = z.object({
  texte: z.string().min(3),
  citation: z.string().min(1),
  article: z.string().nullable(),
  type: z.enum(TYPES_EXIGENCE),
  categorie: z.enum(CATEGORIES_EXIGENCE),
  // Pas de confiance ici : elle est calculee par le code a partir de signaux
  // objectifs, dans confiance.ts. Le modele repondait 1 partout.
  fait: schemaFaitBrut.nullable(),
});

export type ExigenceBrute = z.infer<typeof schemaExigenceBrute>;

export const schemaSortieExtraction = z.object({
  exigences: z.array(schemaExigenceBrute),
});

export type SortieExtraction = z.infer<typeof schemaSortieExtraction>;

/**
 * Le meme contrat, en JSON Schema, pour le mode strict du service.
 * Le mode strict impose que chaque propriete figure dans `required` et que
 * `additionalProperties` vaille false a chaque niveau.
 */
export const SCHEMA_JSON_EXTRACTION = {
  type: "object",
  additionalProperties: false,
  required: ["exigences"],
  properties: {
    exigences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["texte", "citation", "article", "type", "categorie", "fait"],
        properties: {
          texte: {
            type: "string",
            description: "L'exigence reformulee en une phrase courte et verifiable.",
          },
          citation: {
            type: "string",
            description:
              "Extrait recopie mot pour mot depuis la page, sans reformulation ni coupure.",
          },
          article: {
            type: ["string", "null"],
            description: "Par exemple 'Reglement art. 3.4' ou 'CPS art. 7'. null si absent.",
          },
          type: { type: "string", enum: [...TYPES_EXIGENCE] },
          categorie: { type: "string", enum: [...CATEGORIES_EXIGENCE] },
          fait: {
            type: ["object", "null"],
            additionalProperties: false,
            required: [
              "kind",
              "valeurBrute",
              "surBrute",
              "nomBrut",
              "nombreBrut",
              "secteurBrut",
              "anneesMaxBrut",
              "posteBrut",
              "experienceMinBrut",
            ],
            properties: {
              kind: { type: "string", enum: [...KINDS_FAIT] },
              valeurBrute: {
                type: ["string", "null"],
                description:
                  "Valeur chiffree recopiee TELLE QUELLE du document, jamais convertie : 'soixante', '12 778 000.00'.",
              },
              surBrute: {
                type: ["string", "null"],
                description: "Pour note_technique_min : le total, recopie tel quel.",
              },
              nomBrut: {
                type: ["string", "null"],
                description: "Pour certification_requise ou attestation_requise : le nom exact.",
              },
              nombreBrut: {
                type: ["string", "null"],
                description: "Pour references_min ou profil_equipe : le compte, recopie tel quel.",
              },
              secteurBrut: { type: ["string", "null"], description: "Pour references_min." },
              anneesMaxBrut: {
                type: ["string", "null"],
                description: "Pour references_min : l'anciennete maximale, recopiee telle quelle.",
              },
              posteBrut: { type: ["string", "null"], description: "Pour profil_equipe." },
              experienceMinBrut: {
                type: ["string", "null"],
                description: "Pour profil_equipe : l'experience exigee, recopiee telle quelle.",
              },
            },
          },
        },
      },
    },
  },
} as const;
