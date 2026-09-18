import { useCallback, useEffect, useState } from "react";

const URL_API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

type EtatDependance = {
  ok: boolean;
  latenceMs: number;
  detail: string | null;
};

type Sante = {
  statut: "ok" | "degrade";
  service: string;
  horodatage: string;
  postgres: EtatDependance;
  redis: EtatDependance;
  variablesManquantes: string[];
};

type Chargement =
  | { phase: "attente" }
  | { phase: "recu"; sante: Sante }
  | { phase: "injoignable"; detail: string };

/** Un voyant. Trois etats seulement : vert, rouge, gris tant qu'on ne sait pas. */
function Voyant(props: { nom: string; etat: "ok" | "ko" | "inconnu"; note: string }) {
  return (
    <li className="voyant">
      <span className={`pastille pastille--${props.etat}`} aria-hidden="true" />
      <span className="voyant__nom">{props.nom}</span>
      <span className="voyant__note">{props.note}</span>
    </li>
  );
}

export function App() {
  const [chargement, setChargement] = useState<Chargement>({ phase: "attente" });

  const interroger = useCallback(async () => {
    try {
      // /health repond 503 quand le service est degrade : le corps reste
      // exploitable, on le lit au lieu de traiter la reponse comme une panne.
      const reponse = await fetch(`${URL_API}/health`);
      const sante = (await reponse.json()) as Sante;
      setChargement({ phase: "recu", sante });
    } catch (erreur) {
      const detail = erreur instanceof Error ? erreur.message : String(erreur);
      setChargement({ phase: "injoignable", detail });
    }
  }, []);

  useEffect(() => {
    void interroger();
    const minuteur = setInterval(() => void interroger(), 5000);
    return () => clearInterval(minuteur);
  }, [interroger]);

  const sante = chargement.phase === "recu" ? chargement.sante : null;

  const etatApi: "ok" | "ko" | "inconnu" =
    chargement.phase === "attente" ? "inconnu" : chargement.phase === "recu" ? "ok" : "ko";

  const etatDe = (dep: EtatDependance | undefined): "ok" | "ko" | "inconnu" => {
    if (!dep) return chargement.phase === "attente" ? "inconnu" : "ko";
    return dep.ok ? "ok" : "ko";
  };

  const note = (dep: EtatDependance | undefined): string => {
    if (!dep) return chargement.phase === "attente" ? "..." : "non interrogeable";
    return dep.ok ? `${dep.latenceMs} ms` : (dep.detail ?? "injoignable");
  };

  return (
    <main className="page">
      <header className="entete">
        <h1>TenderPilot</h1>
        <p className="sous-titre">Etat des services. Tranche 1 : squelette.</p>
      </header>

      <section className="carte">
        <ul className="voyants">
          <Voyant
            nom="API"
            etat={etatApi}
            note={
              chargement.phase === "injoignable"
                ? chargement.detail
                : chargement.phase === "recu"
                  ? chargement.sante.statut
                  : "..."
            }
          />
          <Voyant nom="PostgreSQL" etat={etatDe(sante?.postgres)} note={note(sante?.postgres)} />
          <Voyant nom="Redis" etat={etatDe(sante?.redis)} note={note(sante?.redis)} />
        </ul>

        {sante && sante.variablesManquantes.length > 0 && (
          <div className="alerte">
            <strong>Variables d'environnement manquantes</strong>
            <ul>
              {sante.variablesManquantes.map((nom) => (
                <li key={nom}>
                  <code>{nom}</code>
                </li>
              ))}
            </ul>
            <p className="alerte__note">
              Seuls les noms sont affiches. Aucune valeur ne transite par l'interface.
            </p>
          </div>
        )}

        <footer className="pied">
          <button type="button" onClick={() => void interroger()}>
            Reinterroger
          </button>
          <span className="pied__note">
            {sante ? `Derniere reponse : ${new Date(sante.horodatage).toLocaleTimeString("fr-FR")}` : "en attente"}
          </span>
        </footer>
      </section>
    </main>
  );
}
