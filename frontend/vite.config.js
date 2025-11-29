import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Load env vars from repo root so we can share a single .env.
  envDir: path.resolve(__dirname, '..'),
})
