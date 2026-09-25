/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mainnet" on the production deploy; anything else (or unset) = Arc Testnet */
  readonly VITE_ARC_NETWORK?: string;
  /** Privy app id: enables email / Google sign-in with an embedded wallet */
  readonly VITE_PRIVY_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
