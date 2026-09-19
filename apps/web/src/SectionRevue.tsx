import { useEffect, useState } from "react";
import { regenererSection, reviserSection, type SectionMemoire } from "./api";

type Props = {
  documentId: string;
  section: SectionMemoire;
  onChangement: () => void;
};

const LIBELLE_REVUE: Record<SectionMemoire["statut_revue"], string> = {
  a_revoir: "a revoir",
  validee: "validee par l'humain",
  corrigee: "corrigee par l'humain",
};

/**
 * Une section, et sa revue.
 *
 * Valider ou corriger PROTEGE la section : une regeneration globale ne la
 * reecrira plus. Le seul bouton qui ecrase du travail humain est celui de
 * regeneration de cette section, et il demande confirmation.
 */
export function SectionRevue({ documentId, section, onChangement }: Props) {
  const [edition, setEdition] = useState(false);
  const [brouillon, setBrouillon] = useState(section.contenu);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    setBrouillon(section.contenu);
  }, [section.contenu, section.statut_revue]);

  async function agir(action: () => Promise<void>): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      await action();
      setEdition(false);
      onChangement();
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setEnvoi(false);
    }
  }

  const aCompleter = section.statut === "a_completer";

  return (
    <article
      className={`section section--${section.statut_revue} ${
        aCompleter ? "section--a-completer" : ""
      }`}
    >
      <header className="section__entete">
        <h3 className="section__titre">
          {section.ordre}. {section.titre}
        </h3>
        {aCompleter && <span className="section__marque">a completer</span>}
        {section.statut_revue !== "a_revoir" && (
          <span className={`revue revue--${section.statut_revue}`}>
            {LIBELLE_REVUE[section.statut_revue]}
          </span>
        )}
        {!aCompleter && section.statut_revue === "a_revoir" && section.tentatives > 1 && (
          <span className="section__reprise">redigee apres une regeneration</span>
        )}
      </header>

      {aCompleter && !edition && (
        <p className="section__motif">Motif du rejet : {section.motif}</p>
      )}

      {!edition && !aCompleter && (
        <>
          {section.contenu.split("\n\n").map((paragraphe, rang) => (
            <p key={rang} className="section__texte">
              {paragraphe}
            </p>
          ))}
          {section.references_citees.length > 0 && (
            <p className="section__references">
              References citees, toutes verifiees dans references.csv :{" "}
              {section.references_citees.join(", ")}
            </p>
          )}
        </>
      )}

      {edition && (
        <textarea
          className="section__edition"
          value={brouillon}
          rows={12}
          onChange={(evenement) => setBrouillon(evenement.target.value)}
        />
      )}

      {erreur && <p className="erreur">{erreur}</p>}

      <div className="section__actions">
        {!edition ? (
          <>
            {section.statut_revue !== "validee" && !aCompleter && (
              <button
                type="button"
                className="bouton-secondaire"
                disabled={envoi}
                onClick={() =>
                  void agir(() => reviserSection(documentId, section.ordre, { action: "valider" }))
                }
              >
                Valider telle quelle
              </button>
            )}
            <button
              type="button"
              className="bouton-secondaire"
              disabled={envoi}
              onClick={() => setEdition(true)}
            >
              {aCompleter ? "Rediger cette section" : "Corriger"}
            </button>
            <button
              type="button"
              className="bouton-discret"
              disabled={envoi}
              onClick={() => {
                const avertissement =
                  section.statut_revue === "corrigee"
                    ? "Cette section porte une correction humaine. La regenerer l'ecrasera definitivement. Continuer ?"
                    : "Regenerer cette section ?";
                if (window.confirm(avertissement)) {
                  void agir(() => regenererSection(documentId, section.ordre));
                }
              }}
            >
              Regenerer
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="bouton-principal"
              disabled={envoi || brouillon.trim().length === 0}
              onClick={() =>
                void agir(() =>
                  reviserSection(documentId, section.ordre, {
                    action: "corriger",
                    contenu: brouillon,
                  }),
                )
              }
            >
              Enregistrer la correction
            </button>
            <button
              type="button"
              className="bouton-discret"
              disabled={envoi}
              onClick={() => {
                setBrouillon(section.contenu);
                setEdition(false);
              }}
            >
              Annuler
            </button>
          </>
        )}
      </div>
    </article>
  );
}
