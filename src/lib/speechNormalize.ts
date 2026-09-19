// Turns a spoken transcript into something the command parser understands.
// Pure (no browser APIs) so it can be unit-tested.

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100,
};

// "twenty five" → 25, "one hundred" → 100 (small numbers only; bigger ones arrive as digits anyway)
function wordsToNumbers(text: string): string {
  const words = Object.keys(NUMBER_WORDS).join('|');
  const run = new RegExp(`\\b(?:${words})(?:[\\s-]+(?:${words}))*\\b`, 'gi');
  return text.replace(run, (match) => {
    let total = 0;
    let current = 0;
    for (const w of match.toLowerCase().split(/[\s-]+/)) {
      const n = NUMBER_WORDS[w];
      if (n === undefined) return match;
      if (n === 100) current = (current || 1) * 100;
      else current += n;
    }
    total += current;
    return String(total);
  });
}

export function normalizeSpokenCommand(raw: string): string {
  let t = raw.trim();

  // Names and decimals: "james dot arc" → james.arc, "2 point 5" → 2.5
  t = t.replace(/\s+dot\s+arc\b/gi, '.arc');
  t = t.replace(/\b(\w+)\.\s*arc\b/gi, '$1.arc');
  t = wordsToNumbers(t);
  t = t.replace(/(\d)\s+point\s+(\d)/gi, '$1.$2');

  // Token names as they're commonly transcribed
  t = t.replace(/\bu\.?\s*s\.?\s*d\.?\s*c\b/gi, 'USDC');
  t = t.replace(/\busd\s*see\b|\bu\s*s\s*d\s*see\b/gi, 'USDC');
  t = t.replace(/\be\.?\s*u\.?\s*r\.?\s*c\b/gi, 'EURC');
  t = t.replace(/\bsearch\s*btc\b|\bsir\s*btc\b|\bseer\s*btc\b/gi, 'cirBTC');

  // "$5" and "5 dollars" both stay understandable; tidy spacing and a trailing period
  t = t.replace(/\s{2,}/g, ' ').replace(/[.!?]$/, '');
  return t;
}
