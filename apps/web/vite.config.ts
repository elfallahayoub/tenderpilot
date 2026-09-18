import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // ecoute sur 0.0.0.0, sinon inaccessible depuis l'hote
    port: 5173,
    strictPort: true,
    // Scrutin obligatoire : les evenements du systeme de fichiers ne
    // traversent pas un montage Windows vers un conteneur Linux.
    watch: { usePolling: true, interval: 300 },
  },
});
