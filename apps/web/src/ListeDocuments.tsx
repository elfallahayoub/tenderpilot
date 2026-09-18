import { LIBELLE_EXTRACTION, LIBELLE_STATUT, type Document } from "./types";

type Props = {
  documents: Document[];
  selectionne: string | null;
  onSelection: (id: string) => void;
};

/**
 * Liste des avis deposes. La colonne "pages lues" montre les pages lisibles
 * sur le total reellement enregistre : un scan sans couche texte y apparait
 * donc comme 0 sur 4, et non comme un succes.
 */
export function ListeDocuments({ documents, selectionne, onSelection }: Props) {
  if (documents.length === 0) {
    return <p className="vide">Aucun avis depose pour l'instant.</p>;
  }

  return (
    <ul className="documents">
      {documents.map((document) => {
        const total = document.nb_pages ?? document.pages_enregistrees;
        return (
          <li key={document.id}>
            <button
              type="button"
              className={`document ${selectionne === document.id ? "document--actif" : ""}`}
              onClick={() => onSelection(document.id)}
            >
              <span className="document__nom">{document.nom_fichier}</span>
              <span className={`badge badge--${document.statut}`}>
                {LIBELLE_STATUT[document.statut]}
              </span>
              <span className="document__pages">
                {total > 0 ? `${document.pages_lisibles} / ${total} pages lues` : "pages inconnues"}
                {document.statut === "traite" && (
                  <>
                    {" · "}
                    {document.statut_extraction === "termine"
                      ? `${document.nb_exigences} exigences`
                      : LIBELLE_EXTRACTION[document.statut_extraction]}
                    {document.nb_eliminatoires > 0 && (
                      <span className="document__bloquants">
                        {" "}
                        dont {document.nb_eliminatoires} eliminatoires
                      </span>
                    )}
                  </>
                )}
              </span>
              {document.motif_echec && (
                <span className="document__motif">{document.motif_echec}</span>
              )}
              {document.motif_extraction && (
                <span className="document__motif">analyse : {document.motif_extraction}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
