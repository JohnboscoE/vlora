import { useEffect, useState } from 'react';
import { ConnectKitButton } from 'connectkit';
import { toast } from 'sonner';
import { Check, Copy, LogOut, Mail, Wallet } from 'lucide-react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSetActiveWallet } from '@privy-io/wagmi';
import { useAccount } from 'wagmi';
import { PRIVY_APP_ID } from '@/config';

const connected =
  'flex h-10 items-center gap-2 rounded-full border border-line/15 bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-2';
const idle =
  'flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-ink transition-transform hover:scale-[1.03] active:scale-[0.98]';

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * The address chip doubles as a copy button — an embedded wallet has no wallet UI
 * of its own to copy from, so this is the only way to get the full address out.
 */
function AddressChip({ address, title }: { address: `0x${string}`; title?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        toast.success('Wallet address copied');
        setTimeout(() => setCopied(false), 1800);
      },
      () => toast.error(`Couldn't copy. Your address is ${address}`),
    );
  };
  return (
    <button onClick={copy} className={connected} title={title ?? 'Copy your wallet address'} aria-label={`Copy wallet address ${address}`}>
      <span className="size-2 rounded-full bg-success" />
      <span className="mono text-xs">{short(address)}</span>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5 text-muted" />}
    </button>
  );
}

/** ConnectKit flow: browser wallet only (used when Privy isn't configured) */
function InjectedWalletButton() {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, truncatedAddress, ensName }) => (
        <button onClick={show} className={isConnected ? connected : idle}>
          {isConnected ? (
            <>
              <span className="size-2 rounded-full bg-success" />
              <span className="mono text-xs">{ensName ?? truncatedAddress}</span>
            </>
          ) : (
            <>
              <Wallet className="size-4" />
              <span>
                Connect<span className="hidden sm:inline"> wallet</span>
              </span>
            </>
          )}
        </button>
      )}
    </ConnectKitButton.Custom>
  );
}

/**
 * Privy flow: one button opens Privy's modal, which offers a browser wallet,
 * email or Google. Email and Google users get an embedded wallet created for them,
 * which works everywhere in the app — including creating an agent wallet.
 */
function PrivyWalletButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address, isConnected } = useAccount();

  // After an email/Google login the embedded wallet exists but wagmi may not have it
  // as the active connection yet; adopt the first one Privy reports.
  useEffect(() => {
    const first = wallets[0];
    if (authenticated && first && !isConnected) void setActiveWallet(first);
  }, [authenticated, wallets, isConnected, setActiveWallet]);

  if (!ready) {
    return <span className={`${idle} pointer-events-none opacity-60`}>Loading…</span>;
  }

  if (!authenticated) {
    return (
      <button onClick={login} className={idle}>
        <Wallet className="size-4" />
        <span>
          Sign in<span className="hidden sm:inline"> or connect</span>
        </span>
      </button>
    );
  }

  const email = user?.email?.address ?? user?.google?.email;

  return (
    <div className="flex items-center gap-1.5">
      {address ? (
        <AddressChip address={address} title={email ? `Wallet for ${email} — click to copy` : 'Copy your wallet address'} />
      ) : (
        <span className={connected}>
          <Mail className="size-3.5 text-muted" />
          <span className="mono text-xs">{email ?? 'Signed in'}</span>
        </span>
      )}
      <button
        onClick={() => void logout()}
        aria-label="Sign out"
        title="Sign out"
        className="flex size-10 items-center justify-center rounded-full border border-line/15 bg-surface text-muted transition-colors hover:text-ink"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

export function WalletButton() {
  return PRIVY_APP_ID ? <PrivyWalletButton /> : <InjectedWalletButton />;
}
