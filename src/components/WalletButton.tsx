import { ConnectKitButton } from 'connectkit';
import { Wallet } from 'lucide-react';

// ConnectKit's default button renders unstyled in light mode; this keeps the
// same modal/flow but matches the app's primary button in both themes.
export function WalletButton() {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, truncatedAddress, ensName }) => (
        <button
          onClick={show}
          className={
            isConnected
              ? 'flex h-10 items-center gap-2 rounded-full border border-line/15 bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-2'
              : 'flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-ink transition-transform hover:scale-[1.03] active:scale-[0.98]'
          }
        >
          {isConnected ? (
            <>
              <span className="size-2 rounded-full bg-success" />
              <span className="mono text-xs">{ensName ?? truncatedAddress}</span>
            </>
          ) : (
            <>
              <Wallet className="size-4" />
              <span>Connect<span className="hidden sm:inline"> wallet</span></span>
            </>
          )}
        </button>
      )}
    </ConnectKitButton.Custom>
  );
}
