import { useCallback, useEffect, useRef, useState } from "react";
import { listerDocuments, lireSante } from "./api";
import { ZoneDepot } from "./ZoneDepot";
import { ListeDocuments } from "./ListeDocuments";
import { VueDocument } from "./VueDocument";
import { Matrice } from "./Matrice";
import { Journal } from "./Journal";
import { enCours, type Document, type Sante } from "./types";

type Onglet = "matrice" | "pages";

/** Sondage rapproche tant qu'un document bouge, repos ensuite. */
const PERIODE_ACTIVE_MS = 2000;
const PERIODE_REPOS_MS = 10000;

export function App() {
  const [sante, setSante] = useState<Sante | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  // La matrice est ce que le jury vient voir : elle s'ouvre par defaut.
  const [onglet, setOnglet] = useState<Onglet>("matrice");

  // Evite de relancer le minuteur a chaque rendu.
  const travailEnCours = useRef(false);
  travailEnCours.current = documents.some(enCours);

  const rafraichir = useCallback(async () => {
    try {
      const [etat, liste] = await Promise.all([lireSante(), listerDocuments()]);
      setSante(etat);
      setDocuments(liste);
      setErreur(null);
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void rafraichir();
    let minuteur: ReturnType<typeof setTimeout>;
    const boucle = () => {
      minuteur = setTimeout(() => {
        void rafraichir().finally(boucle);
      }, travailEnCours.current ? PERIODE_ACTIVE_MS : PERIODE_REPOS_MS);
    };
    boucle();
    return () => clearTimeout(minuteur);
  }, [rafraichir]);

  const documentSelectionne = documents.find((document) => document.id === selection) ?? null;

  const pastille = (ok: boolean | undefined): string =>
    ok === undefined ? "pastille--inconnu" : ok ? "pastille--ok" : "pastille--ko";

  return (
    <main className="page">
      <header className="entete">
        <h1>TenderPilot</h1>
        <div className="sante">
          <span className={`pastille ${pastille(sante ? true : undefined)}`} />
          <span>API</span>
          <span className={`pastille ${pastille(sante?.postgres.ok)}`} />
          <span>Postgres</span>
          <span className={`pastille ${pastille(sante?.redis.ok)}`} />
          <span>Redis</span>
          {sante && sante.variablesManquantes.length > 0 && (
            <span className="sante__alerte">
              {sante.variablesManquantes.length} variables manquantes :{" "}
              {sante.variablesManquantes.join(", ")}
            </span>
          )}
        </div>
      </header>

      <ZoneDepot
        onDepot={(texte, documentId) => {
          setMessage(texte);
          // Le depot selectionne le document : le journal se met a defiler
          // sans clic supplementaire, ce qui est le chemin de la demonstration.
          setSelection(documentId);
          setOnglet("matrice");
          void rafraichir();
        }}
      />

      {message && <p className="info">{message}</p>}
      {erreur && <p className="erreur">API injoignable : {erreur}</p>}

      <div className="colonnes">
        <div className="colonne colonne--liste">
          <h2 className="titre-section">Avis deposes</h2>
          <ListeDocuments
            documents={documents}
            selectionne={selection}
            onSelection={setSelection}
          />
        </div>
        <div className="colonne colonne--detail">
          {documentSelectionne ? (
            <>
              <nav className="onglets">
                <button
                  type="button"
                  className={onglet === "matrice" ? "onglet onglet--actif" : "onglet"}
                  onClick={() => setOnglet("matrice")}
                >
                  Matrice de conformite
                  {documentSelectionne.nb_exigences > 0 && (
                    <span className="onglet__compte">{documentSelectionne.nb_exigences}</span>
                  )}
                </button>
                <button
                  type="button"
                  className={onglet === "pages" ? "onglet onglet--actif" : "onglet"}
                  onClick={() => setOnglet("pages")}
                >
                  Pages du document
                </button>
              </nav>
              {onglet === "matrice" ? (
                <Matrice document={documentSelectionne} />
              ) : (
                <VueDocument document={documentSelectionne} />
              )}
            </>
          ) : (
            <p className="vide">Choisissez un avis pour voir sa matrice de conformite.</p>
          )}
        </div>

        <aside className="colonne colonne--journal">
          {documentSelectionne ? (
            <Journal document={documentSelectionne} />
          ) : (
            <p className="vide">
              Le journal de l'agent s'affiche ici : chaque etape, le modele qui l'a
              traitee, ses jetons et sa duree.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
