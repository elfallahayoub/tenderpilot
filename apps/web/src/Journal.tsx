import { useEffect, useRef, useState } from "react";
import { lireJournal } from "./api";
import { AGENT_HUMAIN, enCours, LIBELLE_CODE_SEUL, type Document } from "./types";
import type { EvenementJournal, Recapitulatif } from "./types";

type Props = {
  document: Document;
};

/** Sondage rapproche tant que le traitement avance, aucun ensuite. */
const PERIODE_MS = 1500;

/**
 * Journal de l'agent.
 *
 * Tout ce qui s'affiche ici existait deja dans agent_events : ce panneau ne
 * calcule rien, il rend visible. C'est ce qui permet de montrer la boucle
 * agentique plutot que de la decrire, et de rejouer a l'identique le
 * traitement d'un document lu il y a des semaines.
 *
 * Contrainte de conception : ce panneau est filme, et la video sera regardee
 * en petit. La densite a ete sacrifiee a la lisibilite partout ou les deux
 * s'opposaient.
 */
export function Journal({ document }: Props) {
  const [evenements, setEvenements] = useState<EvenementJournal[]>([]);
  const [recapitulatif, setRecapitulatif] = useState<Recapitulatif | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const liste = useRef<HTMLOListElement>(null);

  const actif = enCours(document);

  useEffect(() => {
    let abandonne = false;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    let derniere = 0;

    setEvenements([]);
    setRecapitulatif(null);
    setErreur(null);

    async function lire(): Promise<void> {
      try {
        const reponse = await lireJournal(document.id, derniere);
        if (abandonne) return;
        derniere = reponse.derniereSequence;
        // On ajoute l'increment plutot que de tout remplacer : le panneau ne
        // sautille pas pendant qu'il defile.
        if (reponse.evenements.length > 0) {
          setEvenements((precedents) => [...precedents, ...reponse.evenements]);
        }
        setRecapitulatif(reponse.recapitulatif);
        setErreur(null);
      } catch (cause) {
        if (!abandonne) setErreur(cause instanceof Error ? cause.message : String(cause));
      }
    }

    function boucle(): void {
      void lire().finally(() => {
        if (abandonne || !actif) return;
        minuteur = setTimeout(boucle, PERIODE_MS);
      });
    }

    boucle();

    return () => {
      abandonne = true;
      if (minuteur !== undefined) clearTimeout(minuteur);
    };
  }, [document.id, actif]);

  // Defilement automatique vers la derniere etape, uniquement en direct.
  useEffect(() => {
    if (actif && liste.current) {
      liste.current.scrollTop = liste.current.scrollHeight;
    }
  }, [evenements.length, actif]);

  return (
    <section className="journal">
      <header className="journal__entete">
        <h2 className="journal__titre">
          Journal de l'agent
          {actif && <span className="journal__direct">en direct</span>}
        </h2>
        <p className="journal__sous-titre">{document.nom_fichier}</p>
      </header>

      {recapitulatif && <Recap recapitulatif={recapitulatif} />}

      {erreur && <p className="erreur">Journal illisible : {erreur}</p>}

      {evenements.length === 0 && !erreur && (
        <p className="vide">Aucune etape journalisee pour ce document.</p>
      )}

      <ol className="journal__liste" ref={liste}>
        {evenements.map((evenement) => (
          <Ligne key={evenement.sequence} evenement={evenement} />
        ))}
      </ol>
    </section>
  );
}

/** Duree lisible : 840 ms, 12,4 s, 3 min 05 s. */
function duree(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const minutes = Math.floor(ms / 60000);
  const secondes = Math.round((ms % 60000) / 1000);
  return `${minutes} min ${String(secondes).padStart(2, "0")} s`;
}

function nombre(valeur: number): string {
  return valeur.toLocaleString("fr-FR").replace(/ | /g, " ");
}

function Recap({ recapitulatif }: { recapitulatif: Recapitulatif }) {
  const r = recapitulatif;
  return (
    <div className="recap">
      <div className="recap__chiffres">
        <Chiffre valeur={duree(r.dureeTotaleMs)} libelle="du depot a la fin" />
        <Chiffre valeur={duree(r.tempsModelesMs)} libelle="dans les modeles" />
        {r.tempsOcrMs > 0 && <Chiffre valeur={duree(r.tempsOcrMs)} libelle="en OCR" />}
        <Chiffre valeur={String(r.evenements)} libelle="etapes" />
      </div>

      {/* Le routage, chiffre en une ligne : qui a fait quoi, et a quel prix. */}
      <table className="recap__modeles">
        <tbody>
          {r.parModele.map((ligne) => (
            <tr key={ligne.modele}>
              <td>
                <span
                  className={`modele modele--${ligne.modele === LIBELLE_CODE_SEUL ? "code" : ligne.modele.replace(".", "-")}`}
                >
                  {ligne.modele}
                </span>
              </td>
              <td className="recap__appels">
                {/* Une etape en code pur n'est pas un appel : le mot change. */}
                {ligne.appels}{" "}
                {ligne.modele === LIBELLE_CODE_SEUL
                  ? ligne.appels > 1
                    ? "etapes"
                    : "etape"
                  : ligne.appels > 1
                    ? "appels"
                    : "appel"}
              </td>
              <td className="recap__jetons">
                {ligne.modele === LIBELLE_CODE_SEUL
                  ? "aucun jeton"
                  : `${nombre(ligne.jetons)} jetons`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="recap__notes">
        {r.appelsServisParLeCache > 0 && (
          <span>
            {r.appelsServisParLeCache} appel{r.appelsServisParLeCache > 1 ? "s" : ""} servi
            {r.appelsServisParLeCache > 1 ? "s" : ""} par le cache.{" "}
          </span>
        )}
        {r.reprises > 0 && (
          <span className="recap__alerte">
            {r.reprises} reprise{r.reprises > 1 ? "s" : ""}.{" "}
          </span>
        )}
        {r.escalades > 0 && (
          <span className="recap__alerte">
            {r.escalades} escalade{r.escalades > 1 ? "s" : ""}.{" "}
          </span>
        )}
        {r.citationsRejetees > 0 && (
          <span className="recap__citation">
            {r.citationsRejetees} exigence{r.citationsRejetees > 1 ? "s" : ""} rejetee
            {r.citationsRejetees > 1 ? "s" : ""} faute de citation.
          </span>
        )}
      </p>
    </div>
  );
}

function Chiffre({ valeur, libelle }: { valeur: string; libelle: string }) {
  return (
    <div className="chiffre">
      <span className="chiffre__valeur">{valeur}</span>
      <span className="chiffre__libelle">{libelle}</span>
    </div>
  );
}

/**
 * Une etape. Le liseré gauche suffit a distinguer une reprise, une escalade et
 * un rejet de citation sans lire le texte, ce qui est la contrainte de la video.
 */
function Ligne({ evenement }: { evenement: EvenementJournal }) {
  const citationRejetee = evenement.etape.startsWith("exigence rejetee");
  // Une intervention humaine n est ni un appel au modele ni une etape de code :
  // elle a sa propre marque, c est la boucle humain-machine rendue visible.
  const humain = evenement.agent === AGENT_HUMAIN;
  const marque = humain ? "humain" : citationRejetee ? "citation" : evenement.statut;

  const modele = humain ? "humain" : (evenement.modele ?? LIBELLE_CODE_SEUL);
  const classeModele = humain
    ? "humain"
    : evenement.modele === null
      ? "code"
      : evenement.modele.replace(".", "-");

  return (
    <li className={`etape etape--${marque}`}>
      <div className="etape__haut">
        <span className="etape__decalage">+{duree(evenement.decalageMs)}</span>
        <span className="etape__agent">{evenement.agent}</span>
        <span className={`modele modele--${classeModele}`}>{modele}</span>
      </div>

      <p className="etape__nom">{evenement.etape}</p>

      <div className="etape__bas">
        {evenement.statut !== "succes" && (
          <span className={`etape__statut etape__statut--${marque}`}>
            {citationRejetee ? "citation introuvable" : evenement.statut}
          </span>
        )}
        {evenement.tokens !== null && evenement.tokens > 0 && (
          <span>{nombre(evenement.tokens)} jetons</span>
        )}
        {evenement.dureeMs > 0 && <span>{duree(evenement.dureeMs)}</span>}
      </div>

      <p className="etape__detail">{evenement.detail}</p>
    </li>
  );
}
