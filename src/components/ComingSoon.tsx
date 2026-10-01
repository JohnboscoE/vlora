import { Clock3 } from 'lucide-react';
import { ACTIVE_CHAIN } from '@/chain-env';

interface Planned {
  name: string;
  what: string;
  /** What it is actually waiting on — never "soon" with nothing behind it */
  blockedBy: string;
}

/**
 * What isn't built, and why.
 *
 * Every line says what it is waiting on. A roadmap that only says "coming soon"
 * tells you nothing about whether it is a week away or a licence away, and the
 * difference matters to anyone deciding whether to rely on this.
 */
const PLANNED: Planned[] = [
  {
    name: 'Group saving (TeamUp)',
    what: 'Several people contribute to one pot, and half of them must agree before anything leaves it.',
    blockedBy: 'Needs a new contract holding other people’s money, with voting and refunds. That wants an audit, not a deadline.',
  },
  {
    name: 'Fundraisers',
    what: 'A page anyone can contribute to, with the total raised in public.',
    blockedBy: 'Same contract work as group saving, plus public pages.',
  },
  {
    name: 'Company treasury',
    what: 'A shared balance with several signers, where a majority approves each payment.',
    blockedBy: 'A multisig contract and a role system. After the group-saving contract is audited.',
  },
  {
    name: 'Emailing a statement',
    what: 'Have a statement sent to your inbox instead of downloading it.',
    blockedBy: 'Needs a mail sender and an address to send from. The statement itself is built — Activity has CSV and PDF now.',
  },
  {
    name: 'Exam PINs (WAEC, JAMB, NECO)',
    what: 'Buy a PIN from chat and keep it in your history.',
    blockedBy: 'Bitrefill doesn’t carry them in Nigeria. Needs a Nigerian biller, which means a naira float and its own KYB.',
  },
  {
    name: 'Virtual card',
    what: 'Spend your USDC balance anywhere cards are accepted.',
    blockedBy: 'A licensed card issuer. Not something an app can add on its own.',
  },
  {
    name: 'Flights, transport, mutual funds',
    what: 'Book and pay for travel, or invest, from the same chat.',
    blockedBy: 'Each needs a licensed partner and its own approval. Waiting on the ones already in progress first.',
  },
  {
    name: 'Gift card trading',
    what: 'Sell a gift card for USDC.',
    blockedBy: 'Needs a buyer network and fraud checks. Out of scope until the payment rails are proven.',
  },
];

export function ComingSoon() {
  return (
    <div className="space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Clock3 className="size-4 text-brand" /> What&apos;s next
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Sending, swapping, bills, cashing out, bank deposits, Earn, savings targets, spending charts, statements and the agent wallet work
          today on{' '}
          {ACTIVE_CHAIN.name}. These don&apos;t yet, and each line says what it is waiting on.
        </p>
      </div>

      <ul className="space-y-2">
        {PLANNED.map((item) => (
          <li key={item.name} className="rounded-card-sm border border-line/10 bg-surface/70 p-3">
            <p className="text-xs font-semibold text-ink">{item.name}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.what}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-subtle">{item.blockedBy}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
