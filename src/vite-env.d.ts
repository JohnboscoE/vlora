/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mainnet" on the production deploy; anything else (or unset) = Arc Testnet */
  readonly VITE_ARC_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
