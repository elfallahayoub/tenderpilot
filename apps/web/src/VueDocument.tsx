import { useEffect, useState } from "react";
import { listerPages } from "./api";
import { LIBELLE_STATUT, type Document, type Page } from "./types";

type Props = {
  document: Document;
};

/**
 * Vue page par page. Le numero est affiche en grand et le nombre de
 * caracteres a cote : c'est ce qui permet de verifier a l'oeil que la page
 * affichee est bien la page du PDF, avant de brancher l'extraction d'exigences.
 */
export function VueDocument({ document }: Props) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let abandonne = false;
    setPages(null);
    setErreur(null);

    listerPages(document.id)
      .then((recues) => {
        if (!abandonne) setPages(recues);
      })
      .catch((cause: unknown) => {
        if (!abandonne) setErreur(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      abandonne = true;
    };
    // Les pages arrivent au fur et a mesure : on relit quand le compte change.
  }, [document.id, document.pages_enregistrees, document.statut]);

  return (
    <section className="detail">
      <header className="detail__entete">
        <h2>{document.nom_fichier}</h2>
        <p className="detail__meta">
          <span className={`badge badge--${document.statut}`}>
            {LIBELLE_STATUT[document.statut]}
          </span>
          <span>{document.pages_lisibles} pages lisibles</span>
          <span>{document.nb_pages ?? document.pages_enregistrees} pages au total</span>
          <span className="empreinte">{document.hash_sha256.slice(0, 12)}</span>
        </p>
        {document.motif_echec && <p className="erreur">Echec : {document.motif_echec}</p>}
      </header>

      {erreur && <p className="erreur">Lecture impossible : {erreur}</p>}
      {!erreur && pages === null && <p className="vide">Lecture des pages...</p>}
      {!erreur && pages !== null && pages.length === 0 && (
        <p className="vide">Aucune page enregistree pour l'instant.</p>
      )}

      {pages?.map((page) => (
        <article key={page.id} className={`page-doc ${page.lisible ? "" : "page-doc--illisible"}`}>
          <div className="page-doc__entete">
            <span className="page-doc__numero">{page.numero}</span>
            <div className="page-doc__infos">
              <span className="page-doc__compte">{page.nb_caracteres} caracteres</span>
              <span className="page-doc__source">source : {page.source}</span>
              {!page.lisible && (
                <span className="page-doc__motif">illisible : {page.motif_illisible}</span>
              )}
            </div>
          </div>
          {page.lisible ? (
            <pre className="page-doc__texte">{page.texte}</pre>
          ) : (
            <p className="page-doc__avertissement">
              Aucun texte n'a pu etre lu sur cette page. Rien n'en sera deduit.
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
