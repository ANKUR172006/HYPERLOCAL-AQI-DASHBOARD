import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: /v1/* → http://127.0.0.1:8000
// This preserves the original proxy configuration exactly.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
