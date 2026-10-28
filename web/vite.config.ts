import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // In development the map talks to the server from step 1 on port 3000.
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
