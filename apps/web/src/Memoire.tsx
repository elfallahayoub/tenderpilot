import { useCallback, useEffect, useState } from "react";
import { genererMemoire, lireMemoire, urlDocx, type ReponseMemoire } from "./api";
import { SectionRevue } from "./SectionRevue";
import type { Document } from "./types";

type Props = {
  document: Document;
};

const PERIODE_MS = 2000;

/**
 * Memoire technique.
 *
 * La generation se declenche par un bouton, jamais toute seule : sept appels
 * par avis n'ont de sens ni sur un no-go, ni sur dix avis d'affilee.
 *
 * Une section que les garde-fous ont rejetee deux fois s'affiche ici avec son
 * motif, et se retrouve marquee dans le DOCX. Elle n'est jamais masquee.
 */
export function Memoire({ document }: Props) {
  const [donnees, setDonnees] = useState<ReponseMemoire | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const lire = useCallback(async () => {
    try {
      setDonnees(await lireMemoire(document.id));
      setErreur(null);
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    }
  }, [document.id]);

  useEffect(() => {
    void lire();
  }, [lire]);

  // Sondage seulement pendant la redaction.
  useEffect(() => {
    if (donnees?.statutMemoire !== "en_cours") return;
    const minuteur = setInterval(() => void lire(), PERIODE_MS);
    return () => clearInterval(minuteur);
  }, [donnees?.statutMemoire, lire]);

  async function lancer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      await genererMemoire(document.id);
      await lire();
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setEnvoi(false);
    }
  }

  if (erreur) return <p className="erreur">Memoire illisible : {erreur}</p>;
  if (donnees === null) return <p className="vide">Lecture du memoire...</p>;

  const aCompleter = donnees.sections.filter((section) => section.statut === "a_completer");
  const pret = donnees.statutMemoire === "termine" && donnees.sections.length > 0;

  return (
    <section>
      <div className="memoire__barre">
        <button
          type="button"
          className="bouton-principal"
          disabled={envoi || donnees.statutMemoire === "en_cours"}
          onClick={() => void lancer()}
        >
          {donnees.statutMemoire === "en_cours"
            ? "Redaction en cours..."
            : donnees.sections.length > 0
              ? "Regenerer le memoire"
              : "Generer le memoire"}
        </button>

        {pret && (
          <a className="bouton-secondaire" href={urlDocx(document.id)}>
            Telecharger le DOCX
          </a>
        )}
      </div>

      {donnees.statutMemoire === "echec" && (
        <p className="erreur">Redaction en echec : {donnees.motifMemoire}</p>
      )}

      {donnees.sections.length === 0 && donnees.statutMemoire !== "en_cours" && (
        <p className="vide">
          Aucun memoire n'a encore ete redige pour cet avis. La generation fait sept appels
          au modele, un par section.
        </p>
      )}

      {aCompleter.length > 0 && (
        <div className="bandeau bandeau--alerte">
          <strong>
            {aCompleter.length} section{aCompleter.length > 1 ? "s" : ""} a completer par
            l'humain.
          </strong>{" "}
          Les garde-fous les ont rejetees deux fois. Elles apparaissent marquees dans le
          document exporte, jamais omises.
        </div>
      )}

      {/* Les sections a completer remontent en tete : c est le point d entree
          naturel de la revue. L export DOCX, lui, garde l ordre du document :
          un memoire aux sections permutees ne serait pas remettable. */}
      {[...donnees.sections]
        .sort((a, b) => {
          const priorite = (s: typeof a) => (s.statut === "a_completer" ? 0 : 1);
          return priorite(a) - priorite(b) || a.ordre - b.ordre;
        })
        .map((section) => (
          <SectionRevue
            key={section.ordre}
            documentId={document.id}
            section={section}
            onChangement={() => void lire()}
          />
        ))}

    </section>
  );
}
