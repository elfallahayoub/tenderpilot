import { normaliserEntier, normaliserNombre } from "./nombres.js";
import type { FaitBrut } from "./schemas.js";
import type { Fait } from "./types.js";

/**
 * Passage du fait brut, recopie par le modele, au fait machine.
 *
 * C'est ici que la regle 8 du CLAUDE.md prend effet : toute valeur chiffree
 * traverse normaliserNombre. Aucun nombre du systeme ne vient d'un prompt.
 *
 * Si une valeur necessaire manque ou n'est pas convertible, la fonction rend
 * null avec son motif. L'exigence reste affichee avec son texte et sa citation,
 * mais sans forme machine : le moteur de regles de la tranche 4 ne pourra pas
 * la trancher, et l'interface le dira. Rien n'est devine.
 */
export type ResultatFait =
  | { ok: true; fait: Fait }
  | { ok: false; motif: string };

export function construireFait(brut: FaitBrut | null): ResultatFait {
  if (brut === null) {
    return { ok: false, motif: "aucun fait normalisable" };
  }

  switch (brut.kind) {
    case "chiffre_affaires_min": {
      const valeur = normaliserNombre(brut.valeurBrute);
      if (valeur === null) return manque("chiffre_affaires_min", "valeurBrute", brut.valeurBrute);
      return { ok: true, fait: { kind: "chiffre_affaires_min", valeur } };
    }

    case "effectif_min": {
      const valeur = normaliserEntier(brut.valeurBrute);
      if (valeur === null) return manque("effectif_min", "valeurBrute", brut.valeurBrute);
      return { ok: true, fait: { kind: "effectif_min", valeur } };
    }

    case "certification_requise": {
      const nom = brut.nomBrut?.trim();
      if (!nom) return manque("certification_requise", "nomBrut", brut.nomBrut);
      return { ok: true, fait: { kind: "certification_requise", nom } };
    }

    case "attestation_requise": {
      const nom = brut.nomBrut?.trim();
      if (!nom) return manque("attestation_requise", "nomBrut", brut.nomBrut);
      return { ok: true, fait: { kind: "attestation_requise", nom } };
    }

    case "references_min": {
      const nombre = normaliserEntier(brut.nombreBrut);
      if (nombre === null) return manque("references_min", "nombreBrut", brut.nombreBrut);
      const secteur = brut.secteurBrut?.trim();
      if (!secteur) return manque("references_min", "secteurBrut", brut.secteurBrut);
      const anneesMax = normaliserEntier(brut.anneesMaxBrut);
      if (anneesMax === null) return manque("references_min", "anneesMaxBrut", brut.anneesMaxBrut);
      return { ok: true, fait: { kind: "references_min", nombre, secteur, anneesMax } };
    }

    case "profil_equipe": {
      const poste = brut.posteBrut?.trim();
      if (!poste) return manque("profil_equipe", "posteBrut", brut.posteBrut);
      const nombre = normaliserEntier(brut.nombreBrut);
      if (nombre === null) return manque("profil_equipe", "nombreBrut", brut.nombreBrut);
      const experienceMin = normaliserEntier(brut.experienceMinBrut);
      if (experienceMin === null) {
        return manque("profil_equipe", "experienceMinBrut", brut.experienceMinBrut);
      }
      return { ok: true, fait: { kind: "profil_equipe", poste, nombre, experienceMin } };
    }

    case "note_technique_min": {
      const valeur = normaliserNombre(brut.valeurBrute);
      if (valeur === null) return manque("note_technique_min", "valeurBrute", brut.valeurBrute);
      const sur = normaliserNombre(brut.surBrute);
      if (sur === null) return manque("note_technique_min", "surBrute", brut.surBrute);
      return { ok: true, fait: { kind: "note_technique_min", valeur, sur } };
    }

    default: {
      // Le schema zod interdit d'arriver ici, mais on ne devine pas pour autant.
      const inconnu: never = brut.kind;
      return { ok: false, motif: `type de fait inconnu : ${String(inconnu)}` };
    }
  }
}

function manque(kind: string, champ: string, valeur: string | null): ResultatFait {
  const vu = valeur === null ? "absent" : `"${valeur}"`;
  return { ok: false, motif: `${kind} : ${champ} non convertible (${vu})` };
}
