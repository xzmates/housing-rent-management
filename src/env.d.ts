/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENV_ID: string
  readonly VITE_PUBLISHABLE_KEY: string
  readonly VITE_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}