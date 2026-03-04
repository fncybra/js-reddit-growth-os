import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-dexie': ['dexie', 'dexie-react-hooks'],
          'vendor-charts': ['chart.js', 'react-chartjs-2'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-xlsx': ['xlsx'],
        },
      },
    },
  },
})
