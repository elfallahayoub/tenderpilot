import { useEffect, useState } from "react";
import { listerExigences, urlPdf, type ReponseExigences } from "./api";
import {
  LIBELLE_CATEGORIE,
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
  }, [document.id, document.statut_extraction, document.nb_exigences]);

  if (erreur) return <p className="erreur">Lecture impossible : {erreur}</p>;
  if (donnees === null) return <p className="vide">Lecture de la matrice...</p>;

  const { couverture, exigences } = donnees;
  const groupes = ORDRE_CATEGORIES.map((categorie) => ({
    categorie,
    exigences: exigences.filter((exigence) => exigence.categorie === categorie),
  })).filter((groupe) => groupe.exigences.length > 0);

  return (
    <section>
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
    <li className={`exigence exigence--${exigence.type}`}>
      <button type="button" className="exigence__entete" onClick={props.onBascule}>
        <span className={`type type--${exigence.type}`}>{exigence.type}</span>
        <span className="exigence__texte">{exigence.texte}</span>
        <span className="exigence__page">p. {exigence.page}</span>
        <span className="exigence__confiance" title="confiance de lecture">
          {Math.round(exigence.confiance * 100)} %
        </span>
      </button>

      {props.ouverte && (
        <div className="exigence__detail">
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
        </div>
      )}
    </li>
  );
}
