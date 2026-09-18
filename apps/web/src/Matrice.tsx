import { useEffect, useState } from "react";
import { listerExigences, urlPdf, type ReponseExigences } from "./api";
import {
  LIBELLE_CATEGORIE,
  LIBELLE_ORIGINE,
  LIBELLE_STATUT_EVALUATION,
  type CategorieExigence,
  type Document,
  type Fait,
  type Requirement,
} from "./types";

type Props = {
  document: Document;
};

const ORDRE_CATEGORIES: CategorieExigence[] = [
  "financier",
  "administratif",
  "technique",
  "equipe",
  "delai",
];

/** Rend le fait machine lisible, sans jamais reformuler ses nombres. */
function decrireFait(fait: Fait | null): string {
  if (fait === null) return "aucune forme machine";
  switch (fait.kind) {
    case "chiffre_affaires_min":
      return `chiffre d'affaires minimum : ${fait.valeur.toLocaleString("fr-FR")}`;
    case "effectif_min":
      return `effectif minimum : ${fait.valeur}`;
    case "certification_requise":
      return `certification exigee : ${fait.nom}`;
    case "attestation_requise":
      return `attestation exigee : ${fait.nom}`;
    case "references_min":
      return `${fait.nombre} references en ${fait.secteur}, ${fait.anneesMax} ans maximum`;
    case "profil_equipe":
      return `${fait.nombre} ${fait.poste}, ${fait.experienceMin} ans d'experience`;
    case "note_technique_min":
      return `note technique minimum : ${fait.valeur} sur ${fait.sur}`;
    default:
      return "fait inconnu";
  }
}

/**
 * Matrice de conformite.
 *
 * Le bandeau annonce d'abord la couverture : combien de pages ont ete lues, et
 * lesquelles ne l'ont pas ete. Une matrice batie sur un document partiellement
 * illisible doit se presenter comme telle, sinon elle ment par omission.
 */
export function Matrice({ document }: Props) {
  const [donnees, setDonnees] = useState<ReponseExigences | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);

  useEffect(() => {
    let abandonne = false;
    setErreur(null);

    listerExigences(document.id)
      .then((recues) => {
        if (!abandonne) setDonnees(recues);
      })
      .catch((cause: unknown) => {
        if (!abandonne) setErreur(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      abandonne = true;
    };
  }, [
    document.id,
    document.statut_extraction,
    document.statut_qualification,
    document.nb_exigences,
  ]);

  if (erreur) return <p className="erreur">Lecture impossible : {erreur}</p>;
  if (donnees === null) return <p className="vide">Lecture de la matrice...</p>;

  const { couverture, exigences } = donnees;
  const bloquants = exigences.filter((exigence) => exigence.bloquant === true);
  const indetermines = exigences.filter((exigence) => exigence.statut_evaluation === "indetermine");

  const groupes = ORDRE_CATEGORIES.map((categorie) => ({
    categorie,
    exigences: exigences.filter((exigence) => exigence.categorie === categorie),
  })).filter((groupe) => groupe.exigences.length > 0);

  return (
    <section>
      {donnees.verdict !== null && (
        <div
          className={`verdict verdict--${donnees.verdict} ${
            donnees.verdict === "go" && donnees.reserve ? "verdict--reserve" : ""
          }`}
        >
          <div className="verdict__titre">
            {donnees.verdict === "no_go"
              ? "NO-GO"
              : donnees.reserve
                ? "GO SOUS RESERVE"
                : "GO"}
            <span className="verdict__source">verdict produit par le moteur de regles</span>
          </div>

          {donnees.reserve && (
            <div className="reserve">
              <strong>
                {donnees.verdict === "go"
                  ? "Ce go ne peut pas etre tenu pour franc."
                  : "Document incomplet, ce qui n'affaiblit pas le no-go :"}
              </strong>
              <ul>
                {donnees.reserve.split(" ; ").map((motif) => (
                  <li key={motif}>{motif}</li>
                ))}
              </ul>
              {donnees.verdict === "go" && (
                <p className="reserve__note">
                  Les parties non lues peuvent porter la condition qui bloque. Un point
                  bloquant trouve reste un point bloquant, mais son absence n'est pas
                  demontree ici.
                </p>
              )}
            </div>
          )}
          <p className="verdict__resume">
            {bloquants.length === 0
              ? "Aucun point bloquant : toutes les exigences eliminatoires sont satisfaites."
              : `${bloquants.length} point${bloquants.length > 1 ? "s" : ""} bloquant${
                  bloquants.length > 1 ? "s" : ""
                } : une exigence eliminatoire n'est pas satisfaite.`}
            {indetermines.length > 0 &&
              ` ${indetermines.length} exigence${indetermines.length > 1 ? "s" : ""} rest${
                indetermines.length > 1 ? "ent" : "e"
              } a verifier par un humain.`}
          </p>
          {donnees.anneeReference !== null && (
            <p className="verdict__annee">
              Anciennete des references comptee depuis {donnees.anneeReference}
              {donnees.origineAnneeReference === "seance_publique"
                ? ", date de la seance publique lue dans l'avis"
                : ", annee courante faute de date dans l'avis"}
              .
            </p>
          )}
        </div>
      )}

      {donnees.verdict === null && donnees.statutQualification === "termine" && (
        <div className="verdict verdict--indetermine">
          <div className="verdict__titre">
            VERDICT IMPOSSIBLE
            <span className="verdict__source">le systeme refuse de conclure</span>
          </div>
          <p className="verdict__resume">{donnees.motifQualification}</p>
        </div>
      )}

      {donnees.statutQualification === "en_cours" && (
        <p className="info">Evaluation en cours contre le profil d'entreprise.</p>
      )}
      {donnees.statutQualification === "echec" && (
        <p className="erreur">Evaluation en echec : {donnees.motifQualification}</p>
      )}

      <div className={`bandeau ${couverture.pagesNonLues.length > 0 ? "bandeau--alerte" : ""}`}>
        <strong>
          {couverture.pagesLues} pages lues sur {couverture.pagesTotal}
        </strong>
        {couverture.pagesNonLues.length > 0 ? (
          <span>
            {" "}
            Pages non lues :{" "}
            {couverture.pagesNonLues.map((page) => `${page.numero} (${page.motif})`).join(", ")}.
            Aucune exigence n'a ete deduite de ces pages.
          </span>
        ) : (
          <span> Toutes les pages ont ete analysees.</span>
        )}
        {couverture.pagesOcr.length > 0 && (
          <span className="bandeau__ocr">
            {" "}
            Lues par reconnaissance optique :{" "}
            {couverture.pagesOcr
              .map((page) => `page ${page.numero} (${page.qualite ?? "?"} sur 100)`)
              .join(", ")}
            .
          </span>
        )}
      </div>

      {donnees.statutExtraction === "en_cours" && (
        <p className="info">Analyse en cours, la matrice se complete page par page.</p>
      )}
      {donnees.statutExtraction === "echec" && (
        <p className="erreur">Analyse en echec : {donnees.motifExtraction}</p>
      )}

      {exigences.length === 0 && donnees.statutExtraction === "termine" && (
        <p className="vide">Aucune exigence extraite de ce document.</p>
      )}

      {groupes.map((groupe) => (
        <div key={groupe.categorie} className="groupe">
          <h3 className="groupe__titre">
            {LIBELLE_CATEGORIE[groupe.categorie]}
            <span className="groupe__compte">{groupe.exigences.length}</span>
          </h3>
          <ul className="exigences">
            {groupe.exigences.map((exigence) => (
              <LigneExigence
                key={exigence.id}
                exigence={exigence}
                documentId={document.id}
                ouverte={ouverte === exigence.id}
                onBascule={() => setOuverte(ouverte === exigence.id ? null : exigence.id)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function LigneExigence(props: {
  exigence: Requirement;
  documentId: string;
  ouverte: boolean;
  onBascule: () => void;
}) {
  const { exigence } = props;
  return (
    <li
      className={`exigence exigence--${exigence.type} ${
        exigence.bloquant ? "exigence--bloquant" : ""
      }`}
    >
      <button type="button" className="exigence__entete" onClick={props.onBascule}>
        <span className={`type type--${exigence.type}`}>
          {exigence.bloquant ? "bloquant" : exigence.type}
        </span>
        <span className="exigence__texte">{exigence.texte}</span>
        {exigence.statut_evaluation && (
          <span className={`statut statut--${exigence.statut_evaluation}`}>
            {LIBELLE_STATUT_EVALUATION[exigence.statut_evaluation]}
          </span>
        )}
        <span className="exigence__page">p. {exigence.page}</span>
        <span
          className="exigence__confiance"
          title={exigence.confiance_detail ?? "confiance calculee par le code"}
        >
          {Math.round(exigence.confiance * 100)} %
        </span>
      </button>

      {props.ouverte && (
        <div className="exigence__detail">
          {exigence.preuve && (
            <p className={`preuve preuve--${exigence.statut_evaluation}`}>
              <strong>Preuve :</strong> {exigence.preuve}
              {exigence.origine && (
                <span className="preuve__origine">
                  {LIBELLE_ORIGINE[exigence.origine]}
                  {exigence.modele ? ` (${exigence.modele})` : ""}
                </span>
              )}
            </p>
          )}
          <p className="exigence__citation">{exigence.citation}</p>
          <p className="exigence__meta">
            <span>{exigence.article ?? "article non identifie"}</span>
            <span>page {exigence.page}</span>
            <span>{decrireFait(exigence.fait)}</span>
            <a
              className="lien-pdf"
              href={urlPdf(props.documentId, exigence.page)}
              target="_blank"
              rel="noreferrer"
            >
              ouvrir le PDF page {exigence.page}
            </a>
          </p>
          {exigence.confiance_detail && (
            <p className="exigence__bareme">
              Confiance {Math.round(exigence.confiance * 100)} % :{" "}
              {exigence.confiance_detail}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
