import { ArrowRight, ArrowUpRight, Check, Clock, MessageSquareText, ShieldCheck, PenLine, Zap, CircleDollarSign, Gauge } from 'lucide-react';
import { ShaderBackground } from '@/components/ui/shader-background';
import { TxDemo } from '@/components/TxDemo';
import { ACTIVE_CHAIN } from '@/chain-env';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LogoMark } from '@/components/Logo';

const APP_HREF = '#/app';

const STEPS = [
  {
    icon: MessageSquareText,
    title: 'Type it',
    body: 'Write what you want in plain English — "send 25 USDC to 0x8f3…". No forms, no token pickers.',
  },
  {
    icon: ShieldCheck,
    title: 'Review it',
    body: 'Vlora shows exactly what will happen: amount, recipient, network. Anything invalid is blocked before it reaches your wallet.',
  },
  {
    icon: PenLine,
    title: 'Sign it',
    body: 'Approve in your own wallet. The transfer settles on Arc and you get a link to the explorer.',
  },
];

const ARC_POINTS = [
  { icon: CircleDollarSign, title: 'USDC is the gas', body: 'No second token to buy just to pay fees. You pay in the dollars you are sending.' },
  { icon: Zap, title: 'Fast finality', body: 'Transfers confirm in seconds, so the chat can tell you it is done — not "pending".' },
  { icon: Gauge, title: 'Cents per transfer', body: 'Fees around a cent make small, everyday payments worth doing on-chain.' },
];

const TODAY = [
  'Send USDC to any address, contact or .arc name',
  'Claim your own .arc name and get paid at it',
  'Payment request links',
  'Batch payments: many recipients, one transaction',
  'Swap USDC, EURC and cirBTC at live quotes',
  'Speak your command instead of typing it',
  'Agent wallet (testnet beta): the AI pays within limits you set',
  'Every transaction simulated and confirmed before you sign',
];
const NEXT = [
  'Mainnet launch',
  'Agent wallets on mainnet, with a separate signing key per user',
  'Adding liquidity',
  'A directory of Arc apps you can use from chat',
];

function Nav() {
  return (
    <nav className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 md:px-8">
      <a href="#/" className="flex items-center gap-2.5">
        <LogoMark />
        <span className="display text-xl font-bold text-white">Vlora</span>
      </a>
      <div className="flex items-center gap-3 sm:gap-5">
        <a href="#how" className="hidden text-sm font-medium text-white/75 transition-colors hover:text-white sm:block">
          How it works
        </a>
        <a
          href={APP_HREF}
          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#0b1830] transition-transform hover:scale-[1.03] active:scale-[0.98]"
        >
          Launch app
        </a>
        <ThemeToggle variant="overlay" />
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header className="relative isolate overflow-hidden bg-[#050b1a]">
      <ShaderBackground className="absolute inset-0 -z-20" />
      {/* Darken toward the text side so copy stays legible over bright filaments */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#050b1a]/85 via-[#050b1a]/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-b from-transparent to-[#050b1a]/60" />

      <Nav />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-20 pt-10 md:grid-cols-[1.15fr_1fr] md:px-8 md:pb-28 md:pt-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/85 backdrop-blur">
            <span className="size-1.5 rounded-full bg-[#7ef1b3]" />
            Intent-based payments · {ACTIVE_CHAIN.name}
          </span>
          <h1 className="display mt-6 text-5xl font-bold leading-[1.02] text-white md:text-7xl">
            State the payment.
            <br />
            <span className="bg-gradient-to-r from-[#8fb0ff] to-[#7fe9ff] bg-clip-text text-transparent">Vlora settles it.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
            Vlora turns a one-line instruction into a validated USDC transaction on Arc. Recipient, amount and
            balance are checked up front, and nothing moves until you approve it in your own wallet.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href={APP_HREF}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#0b1830] transition-transform hover:scale-[1.03] active:scale-[0.98]"
            >
              Open the app <ArrowRight className="size-4" />
            </a>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              See how it works
            </a>
          </div>
        </div>
        <div className="flex justify-center md:justify-end">
          <TxDemo />
        </div>
      </div>
    </header>
  );
}

function SectionHeading({ eyebrow, title, className }: { eyebrow: string; title: string; className?: string }) {
  return (
    <div className={cn('max-w-2xl', className)}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">{eyebrow}</p>
      <h2 className="display mt-3 text-3xl font-bold text-ink md:text-4xl">{title}</h2>
    </div>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-8 px-5 py-20 md:px-8 md:py-28">
      <SectionHeading eyebrow="How it works" title="Three steps, and you stay in control." />
      <ol className="mt-12 grid gap-5 md:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="rounded-3xl border border-line/10 bg-surface p-6 shadow-[0_2px_24px_rgba(18,45,69,0.05)]">
            <div className="flex items-center justify-between">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-ink">
                <Icon className="size-5" />
              </div>
              <span className="display text-sm font-semibold text-subtle">0{i + 1}</span>
            </div>
            <h3 className="display mt-5 text-xl font-semibold text-ink">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WhyArc() {
  return (
    <section className="bg-[#122d45] text-white dark:border-y dark:border-line/10 dark:bg-surface">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 md:grid-cols-[1fr_1.4fr] md:px-8 md:py-24">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#85b1ed]">Built on Arc</p>
          <h2 className="display mt-3 text-3xl font-bold md:text-4xl">A chain where dollars are the native currency.</h2>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          {ARC_POINTS.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="size-6 text-[#85b1ed]" />
              <h3 className="display mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Status() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-28">
      <SectionHeading eyebrow="Where it's at" title="What works today, and what's next." />
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        <div className="rounded-3xl border border-line/10 bg-surface p-7">
          <p className="display text-lg font-semibold text-ink">Available now</p>
          <ul className="mt-5 space-y-3">
            {TODAY.map((t) => (
              <li key={t} className="flex items-start gap-3 text-sm text-ink-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-3xl border border-dashed border-line/20 bg-surface/50 p-7">
          <p className="display text-lg font-semibold text-ink">Coming next</p>
          <ul className="mt-5 space-y-3">
            {NEXT.map((t) => (
              <li key={t} className="flex items-start gap-3 text-sm text-muted">
                <Clock className="mt-0.5 size-4 shrink-0 text-subtle" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative isolate mx-5 mb-5 overflow-hidden rounded-[2rem] bg-[#050b1a] md:mx-8 md:mb-8">
      <ShaderBackground className="absolute inset-0 -z-20" />
      <div className="absolute inset-0 -z-10 bg-[#050b1a]/55" />
      <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center md:py-24">
        <h2 className="display text-3xl font-bold text-white md:text-5xl">One sentence. One signature. Settled.</h2>
        <p className="mt-4 max-w-lg text-white/75">Connect a wallet and make your first USDC payment on Arc in under a minute.</p>
        <a
          href={APP_HREF}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-[#0b1830] transition-transform hover:scale-[1.03] active:scale-[0.98]"
        >
          Launch app <ArrowUpRight className="size-4" />
        </a>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <Hero />
      <main>
        <HowItWorks />
        <WhyArc />
        <Status />
        <FinalCta />
      </main>
      <footer className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-5 pb-10 text-xs text-subtle sm:flex-row md:px-8">
        <span className="display font-semibold text-ink">Vlora</span>
        <span>USDC payments on {ACTIVE_CHAIN.name}</span>
      </footer>
    </div>
  );
}
