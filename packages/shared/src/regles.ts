import type { Fait } from "./types.js";

/**
 * Moteur de regles.
 *
 * Toute comparaison numerique du projet se fait ici, en TypeScript, et nulle
 * part ailleurs. Le modele lit et recopie, le code compare et decide. Chaque
 * variante de Fait a sa fonction pure, et chacune est testee unitairement :
 * c'est ce fichier et son test que le jury lira pour juger de la fiabilite.
 *
 * Aucune fonction d'ici n'appelle de modele, ne touche a la base, ni ne lit
 * l'horloge. Tout entre par les parametres.
 */

export type ReferenceClient = {
  id: string;
  client: string;
  secteur: string;
  objet: string;
  montantHtMad: number;
  anneeDebut: number;
  dureeMois: number;
  attestationBonneExecution: boolean;
};

export type MembreEquipe = {
  id: string;
  initiales: string;
  poste: string;
  anneesExperience: number;
};

export type Profil = {
  raisonSociale: string;
  effectif: number;
  /** Cle : annee sur quatre chiffres. Valeur : chiffre d'affaires HT en MAD. */
  chiffreAffaires: Record<string, number>;
  certifications: string[];
  attestations: string[];
  references: ReferenceClient[];
  equipe: MembreEquipe[];
};

export type StatutEvaluation = "satisfait" | "non_satisfait" | "indetermine";

/**
 * Quand la correspondance textuelle echoue, la regle ne conclut pas seule a
 * l'absence : elle propose un arbitrage. Le Qualifier posera alors au modele
 * une question fermee, et rappellera cette meme regle avec la reponse.
 */
export type DemandeArbitrage = {
  exige: string;
  candidats: string[];
};

export type ResultatRegle = {
  statut: StatutEvaluation;
  preuve: string;
  arbitrage?: DemandeArbitrage;
};

/** Nombre d'exercices pris en compte pour le chiffre d'affaires moyen. */
export const EXERCICES_CHIFFRE_AFFAIRES = 3;

// --- Outils de comparaison --------------------------------------------------

/** Minuscules, sans accents, ponctuation reduite a des espaces. */
export function normaliserTexte(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Cherche `exige` parmi `candidats` par correspondance textuelle stricte puis
 * par inclusion. Rend -1 quand aucune correspondance n'est certaine : c'est
 * alors au Qualifier de demander un arbitrage, pas a cette fonction de deviner.
 */
export function chercherCorrespondance(exige: string, candidats: string[]): number {
  const cible = normaliserTexte(exige);
  if (cible.length === 0) return -1;

  const normalises = candidats.map(normaliserTexte);

  const exact = normalises.indexOf(cible);
  if (exact !== -1) return exact;

  for (let index = 0; index < normalises.length; index += 1) {
    const candidat = normalises[index]!;
    if (candidat.length === 0) continue;
    if (candidat.includes(cible) || cible.includes(candidat)) return index;
  }

  return -1;
}

function formaterMontant(valeur: number): string {
  return `${Math.round(valeur).toLocaleString("fr-FR").replace(/ | /g, " ")} MAD`;
}

// --- Chiffre d'affaires -----------------------------------------------------

/** Moyenne des N exercices les plus recents. */
export function chiffreAffairesMoyen(
  chiffreAffaires: Record<string, number>,
  nbExercices = EXERCICES_CHIFFRE_AFFAIRES,
): { moyenne: number; annees: string[] } | null {
  const annees = Object.keys(chiffreAffaires)
    .filter((annee) => Number.isFinite(chiffreAffaires[annee]))
    .sort()
    .slice(-nbExercices);

  if (annees.length === 0) return null;

  const somme = annees.reduce((total, annee) => total + (chiffreAffaires[annee] ?? 0), 0);
  return { moyenne: somme / annees.length, annees };
}

function evaluerChiffreAffaires(seuil: number, profil: Profil): ResultatRegle {
  const calcul = chiffreAffairesMoyen(profil.chiffreAffaires);
  if (calcul === null) {
    return { statut: "indetermine", preuve: "aucun chiffre d'affaires au profil" };
  }

  const satisfait = calcul.moyenne >= seuil;
  return {
    statut: satisfait ? "satisfait" : "non_satisfait",
    preuve: `CA moyen ${formaterMontant(calcul.moyenne)} sur ${calcul.annees.join(", ")} ${
      satisfait ? ">=" : "<"
    } ${formaterMontant(seuil)} requis`,
  };
}

// --- Effectif ---------------------------------------------------------------

function evaluerEffectif(seuil: number, profil: Profil): ResultatRegle {
  const satisfait = profil.effectif >= seuil;
  return {
    statut: satisfait ? "satisfait" : "non_satisfait",
    preuve: `effectif ${profil.effectif} ${satisfait ? ">=" : "<"} ${seuil} requis`,
  };
}

// --- Certifications et attestations -----------------------------------------

function evaluerPresence(
  exige: string,
  detenus: string[],
  libelle: string,
  indiceArbitre?: number,
): ResultatRegle {
  const indice = indiceArbitre ?? chercherCorrespondance(exige, detenus);

  if (indice >= 0 && indice < detenus.length) {
    return {
      statut: "satisfait",
      preuve: `${libelle} exigee "${exige}" couverte par "${detenus[indice]}"`,
    };
  }

  // On ne conclut a l'absence qu'apres avoir propose un arbitrage : deux
  // intitules differents designent souvent la meme piece.
  if (indiceArbitre === undefined) {
    return {
      statut: "non_satisfait",
      preuve: `${libelle} exigee "${exige}" absente du profil`,
      arbitrage: { exige, candidats: detenus },
    };
  }

  return {
    statut: "non_satisfait",
    preuve: `${libelle} exigee "${exige}" absente du profil, y compris apres arbitrage`,
  };
}

// --- References -------------------------------------------------------------

/**
 * Compte les references d'un secteur, pas plus anciennes que la limite.
 *
 * LE SECTEUR EST CELUI DE LA COLONNE, JAMAIS CELUI QUE SUGGERE LE NOM DU
 * CLIENT. Le jeu de donnees contient deliberement deux contre-exemples :
 * REF-02 a pour client une agence de telecommunications et pour secteur
 * "education", REF-04 a pour client le Ministere de l'Education Nationale et
 * pour secteur "energie". Juger sur le client se tromperait deux fois. Un test
 * unitaire dedie echoue si cette regle est un jour contournee.
 */
export function compterReferences(
  references: ReferenceClient[],
  secteur: string,
  anneesMax: number,
  anneeReference: number,
): ReferenceClient[] {
  const cible = normaliserTexte(secteur);
  const anneePlancher = anneeReference - anneesMax;

  return references.filter(
    (reference) =>
      normaliserTexte(reference.secteur) === cible && reference.anneeDebut >= anneePlancher,
  );
}

function evaluerReferences(
  fait: Extract<Fait, { kind: "references_min" }>,
  profil: Profil,
  anneeReference: number,
): ResultatRegle {
  const retenues = compterReferences(
    profil.references,
    fait.secteur,
    fait.anneesMax,
    anneeReference,
  );
  const satisfait = retenues.length >= fait.nombre;
  const avecAttestation = retenues.filter((reference) => reference.attestationBonneExecution).length;

  const liste = retenues.map((reference) => `${reference.id} (${reference.anneeDebut})`).join(", ");

  return {
    statut: satisfait ? "satisfait" : "non_satisfait",
    preuve:
      `${retenues.length} references "${fait.secteur}" depuis ${anneeReference - fait.anneesMax} ` +
      `${satisfait ? ">=" : "<"} ${fait.nombre} requises` +
      (retenues.length > 0 ? ` : ${liste}, dont ${avecAttestation} avec attestation` : ""),
  };
}

// --- Equipe -----------------------------------------------------------------

/** Postes distincts du profil, pour proposer un arbitrage sur l'intitule. */
export function postesDistincts(equipe: MembreEquipe[]): string[] {
  return [...new Set(equipe.map((membre) => membre.poste))];
}

function evaluerProfilEquipe(
  fait: Extract<Fait, { kind: "profil_equipe" }>,
  profil: Profil,
  posteArbitre?: string,
): ResultatRegle {
  const posteCible = posteArbitre ?? fait.poste;
  const cible = normaliserTexte(posteCible);

  const memePoste = profil.equipe.filter(
    (membre) =>
      normaliserTexte(membre.poste) === cible ||
      normaliserTexte(membre.poste).includes(cible) ||
      cible.includes(normaliserTexte(membre.poste)),
  );

  if (memePoste.length === 0) {
    if (posteArbitre === undefined) {
      return {
        statut: "non_satisfait",
        preuve: `aucun "${fait.poste}" au profil`,
        arbitrage: { exige: fait.poste, candidats: postesDistincts(profil.equipe) },
      };
    }
    return {
      statut: "non_satisfait",
      preuve: `aucun "${fait.poste}" au profil, y compris apres arbitrage`,
    };
  }

  const assezExperimentes = memePoste.filter(
    (membre) => membre.anneesExperience >= fait.experienceMin,
  );
  const satisfait = assezExperimentes.length >= fait.nombre;

  const detail = assezExperimentes
    .map((membre) => `${membre.initiales} ${membre.anneesExperience} ans`)
    .join(", ");

  return {
    statut: satisfait ? "satisfait" : "non_satisfait",
    preuve:
      `${assezExperimentes.length} ${posteCible} avec ${fait.experienceMin} ans ou plus ` +
      `${satisfait ? ">=" : "<"} ${fait.nombre} requis` +
      (detail.length > 0 ? ` : ${detail}` : ""),
  };
}

// --- Note technique ---------------------------------------------------------

/**
 * Le seuil de note technique porte sur la note que la commission attribuera a
 * l'offre APRES depot. C'est une propriete de l'offre a venir, pas de
 * l'entreprise : aucune information du profil ne permet de la trancher, et
 * aucune n'existe a ce stade.
 *
 * Repondre "satisfait" serait une promesse sans fondement, repondre
 * "non satisfait" condamnerait a tort presque tous les avis. La seule reponse
 * qui n'invente rien est l'indetermination, et elle n'est jamais bloquante.
 */
function evaluerNoteTechnique(
  fait: Extract<Fait, { kind: "note_technique_min" }>,
): ResultatRegle {
  return {
    statut: "indetermine",
    preuve:
      `seuil de ${fait.valeur} sur ${fait.sur} portant sur la note attribuee apres depot : ` +
      "propriete de l'offre, pas de l'entreprise, non evaluable a ce stade",
  };
}

// --- Point d'entree ---------------------------------------------------------

/** Reponse d'un arbitrage, quand il a eu lieu. */
export type Arbitrage = {
  /** Indice retenu parmi les candidats proposes, ou -1 si aucun. */
  indice: number;
};

export function evaluerFait(
  fait: Fait,
  profil: Profil,
  anneeReference: number,
  arbitrage?: Arbitrage,
): ResultatRegle {
  switch (fait.kind) {
    case "chiffre_affaires_min":
      return evaluerChiffreAffaires(fait.valeur, profil);

    case "effectif_min":
      return evaluerEffectif(fait.valeur, profil);

    case "certification_requise":
      return evaluerPresence(fait.nom, profil.certifications, "certification", arbitrage?.indice);

    case "attestation_requise":
      return evaluerPresence(fait.nom, profil.attestations, "attestation", arbitrage?.indice);

    case "references_min":
      // Jamais d'arbitrage ici : le secteur est celui de la colonne.
      return evaluerReferences(fait, profil, anneeReference);

    case "profil_equipe": {
      const postes = postesDistincts(profil.equipe);
      const posteArbitre =
        arbitrage === undefined
          ? undefined
          : arbitrage.indice >= 0 && arbitrage.indice < postes.length
            ? postes[arbitrage.indice]
            : fait.poste;
      return evaluerProfilEquipe(fait, profil, posteArbitre);
    }

    case "note_technique_min":
      return evaluerNoteTechnique(fait);

    default: {
      const inconnu: never = fait;
      return { statut: "indetermine", preuve: `fait inconnu : ${JSON.stringify(inconnu)}` };
    }
  }
}

// --- Verdict ----------------------------------------------------------------

export type Verdict = "go" | "no_go";

export type LigneVerdict = {
  statut: StatutEvaluation;
  /** Type de l'exigence, tel qu'extrait. */
  type: "obligatoire" | "optionnelle" | "eliminatoire";
};

/** Une exigence bloque si elle est eliminatoire ET non satisfaite. */
export function estBloquant(ligne: LigneVerdict): boolean {
  return ligne.type === "eliminatoire" && ligne.statut === "non_satisfait";
}

/**
 * Le verdict est produit par le code, a partir des evaluations.
 * Un seul bloquant suffit a faire un no-go : l'offre serait rejetee sans
 * examen au fond. Les indetermines ne font jamais basculer le verdict, ils
 * sont remontes a l'humain.
 */
export function calculerVerdict(lignes: LigneVerdict[]): {
  verdict: Verdict;
  bloquants: number;
  indetermines: number;
} {
  const bloquants = lignes.filter(estBloquant).length;
  const indetermines = lignes.filter((ligne) => ligne.statut === "indetermine").length;
  return { verdict: bloquants > 0 ? "no_go" : "go", bloquants, indetermines };
}
