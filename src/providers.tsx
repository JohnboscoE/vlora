import type { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { PrivyProvider, type ConnectedWallet, type User } from '@privy-io/react-auth';
import { WagmiProvider as PrivyWagmiProvider, type SetActiveWalletForWagmiType } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider } from 'connectkit';
import { Toaster } from 'sonner';
import { arc, config, PRIVY_APP_ID } from './config';
import { useTheme } from './lib/theme';

const queryClient = new QueryClient();

/**
 * Which wallet wagmi should treat as connected. Without this, Privy falls back to
 * wagmi's reconnect(), which restores the last connector from browser storage — so
 * after disconnecting a browser wallet and signing in with Google, the old wallet
 * came back instead of the new embedded one.
 *
 * Privy's `user.wallet` is the account the user actually signed in with (their
 * embedded wallet after email/Google, or the browser wallet they connected).
 */
const pickActiveWallet: SetActiveWalletForWagmiType = ({ wallets, user }: { wallets: ConnectedWallet[]; user: User | null }) => {
  const primary = user?.wallet?.address.toLowerCase();
  return (
    (primary ? wallets.find((w) => w.address.toLowerCase() === primary) : undefined) ??
    wallets.find((w) => w.walletClientType === 'privy') ??
    wallets[0]
  );
};

/**
 * Two ways in, same app underneath:
 *
 * - With VITE_PRIVY_APP_ID, Privy handles sign-in. Email or Google gives the user an
 *   embedded wallet (created on first login, keys held by Privy, not by us); "Connect
 *   wallet" still opens MetaMask and friends. Either way wagmi sees one connected
 *   account, so sends, swaps and agent wallets work identically.
 * - Without it, the app uses ConnectKit and an injected wallet, as before.
 */
export function Providers({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const toaster = <Toaster position="top-center" theme={theme} richColors />;

  if (!PRIVY_APP_ID) {
    return (
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <ConnectKitProvider mode={theme}>
            {children}
            {toaster}
          </ConnectKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Wallet stays first: people who already have one shouldn't have to hunt for it
        loginMethods: ['wallet', 'email', 'google'],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        supportedChains: [arc],
        defaultChain: arc,
        appearance: {
          theme: theme === 'dark' ? 'dark' : 'light',
          accentColor: '#1f51ff',
          walletChainType: 'ethereum-only',
          logo: `${window.location.origin}/vlora-logo.svg`,
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={config} setActiveWalletForWagmi={pickActiveWallet}>
          {children}
          {toaster}
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
