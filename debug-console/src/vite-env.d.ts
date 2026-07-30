/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly EXPO_PUBLIC_CONVEX_URL?: string
  readonly VITE_CONVEX_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
