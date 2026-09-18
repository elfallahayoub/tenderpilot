import { useRef, useState } from "react";
import { deposerDocument } from "./api";

type Props = {
  /** Le second argument selectionne le document depose. */
  onDepot: (message: string, documentId: string) => void;
};

/**
 * Zone de depot d'un avis. Le fichier part vers l'api, qui repond des que le
 * travail est en file : l'extraction ne bloque jamais l'interface.
 */
export function ZoneDepot({ onDepot }: Props) {
  const [survol, setSurvol] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  async function envoyer(fichiers: FileList | null): Promise<void> {
    const fichier = fichiers?.[0];
    if (!fichier) return;

    setEnvoi(true);
    setErreur(null);
    try {
      const reponse = await deposerDocument(fichier);
      onDepot(
        reponse.dejaConnu
          ? `${reponse.document.nom_fichier} etait deja connu, aucun retraitement.`
          : `${reponse.document.nom_fichier} depose, traitement en file.`,
        reponse.document.id,
      );
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setEnvoi(false);
      if (champ.current) champ.current.value = "";
    }
  }

  return (
    <section>
      <div
        className={`depot ${survol ? "depot--survol" : ""}`}
        onDragOver={(evenement) => {
          evenement.preventDefault();
          setSurvol(true);
        }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(evenement) => {
          evenement.preventDefault();
          setSurvol(false);
          void envoyer(evenement.dataTransfer.files);
        }}
      >
        <p className="depot__titre">{envoi ? "Envoi en cours..." : "Deposer un avis"}</p>
        <p className="depot__note">
          Glissez un PDF ici, ou{" "}
          <button type="button" className="lien" onClick={() => champ.current?.click()}>
            choisissez un fichier
          </button>
          . 20 Mo au maximum.
        </p>
        <input
          ref={champ}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(evenement) => void envoyer(evenement.target.files)}
        />
      </div>
      {erreur && <p className="erreur">Depot refuse : {erreur}</p>}
    </section>
  );
}
