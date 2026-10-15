/* Ability text parser
 * Turns the wiki's ability sentences ("Start of Combat: Give your axes +4 damage permanently.")
 * into structured effects the simulator can run. Anything it does not understand is reported
 * as `unparsed` so the UI can honestly show "partially simulated".
 * Pure module: no DOM, no globals.
 */
import type { Act, Cond, Coverage, Effect, ItemDef, ParsedAbility, StatMap, Target } from './types';

const STAT: Record<string, keyof StatMap> = {
  damage: 'dmg',
  dmg: 'dmg',
  burn: 'burn',
  poison: 'poison',
  bleed: 'bleed',
  shock: 'shock',
  shield: 'block',
  block: 'block',
  heal: 'heal',
  healing: 'heal',
  multicast: 'mc',
  'crit chance': 'crit',
  crit: 'crit',
};
const IGNORE =
  /(\bgold\b|\bincome\b|sell value|\bxp\b|potion|vial|essence|level up|when obtained|when sold|\bdrag\b|iron stack|wax|ingredient|\bcop(y|ies)\b|random item|random (dark|lesser|bomb)|forge blade|goblet|transform|freeze|\btypes?\b|can't get|can't gain|unlimited charges|pandora|bombs? and|replenish|\bcharge\b|max charge|dream|gain a level|\bbombs?\b|lucky reroll|randomized stats|(many|tons and tons of) stats|\blog\b|logged|gain (?:a|\d+) dreads?\b)/i;

const num = (w: string): number => {
  w = String(w).toLowerCase();
  if (w === 'twice') return 2;
  if (w === 'thrice') return 3;
  if (w === 'a' || w === 'an' || w === 'one') return 1;
  return +w;
};
/** first word of "3 times" / "twice" as a number */
const numW = (w: string): number => num(w.split(' ')[0]!);

const sing = (t: string): string => {
  t = t.toLowerCase().trim();
  if (t === 'axes') return 'axe';
  if (t === 'bombs') return 'warfare';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};

/** "Axe items" -> "axe"; used by the engine to match tags/packs/names */
export const normType = (t: string): string => {
  t = t
    .toLowerCase()
    .replace(/\bitems?\b/g, '')
    .trim();
  return t ? sing(t) : '';
};

const DIRS = {
  above: { dr: -1, dc: 0 },
  below: { dr: 1, dc: 0 },
  'to the right': { dr: 0, dc: 1 },
  'to the left': { dr: 0, dc: -1 },
} as const;
type DirWord = keyof typeof DIRS;

interface ParseState {
  last: Target | null;
}

function parseTarget(r: string, st: ParseState | null): Target | null {
  r = r
    .toLowerCase()
    .trim()
    .replace(/\s+of this$/, '');
  if (r === 'this' || r === 'this item') return { t: 'self' };
  if (r === 'it' || r === 'them') return st && st.last ? st.last : null;
  let m: RegExpMatchArray | null;
  if ((m = r.match(/^adjacent (\w+)$/))) return { t: 'adj', type: normType(m[1]!) };
  if ((m = r.match(/^(?:the )?(?:(\w+) )?items? (above|below|to the right|to the left)$/)))
    return { t: 'dir', dir: DIRS[m[2] as DirWord], type: m[1] ? normType(m[1]) : '' };
  if ((m = r.match(/^(\w+) (above|below|to the right|to the left)$/)))
    return { t: 'dir', dir: DIRS[m[2] as DirWord], type: normType(m[1]!) };
  if ((m = r.match(/^(?:all )?(?:your )?(other )?(.+)$/))) {
    if (/\bwith\b/.test(m[2]!)) return null;
    return { t: 'group', other: !!m[1], type: normType(m[2]!) };
  }
  return null;
}

function parseCond(s: string): Cond | null {
  s = s.toLowerCase().trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^you have (\d+)\+ of a debuff$/))) return { debuffGE: +m[1]! };
  if ((m = s.match(/^you have at least (\d+) (\w+)$/))) return { minTag: [+m[1]!, sing(m[2]!)] };
  if (/^this is your only item$/.test(s)) return { only: true };
  if ((m = s.match(/^you (?:only )?have (?:only )?unique (item types|\w+)$/)))
    return m[1] === 'item types' ? { uniqueTypes: true } : { uniqueTag: sing(m[1]!) };
  return null;
}

interface StatsParse {
  stats: StatMap;
  rand: number;
  per: string | null;
  times: number;
  eqMc: boolean;
  ok?: boolean;
}

function parseStats(text: string): StatsParse {
  const o: StatsParse = { stats: {}, rand: 0, per: null, times: 1, eqMc: false };
  let t = text.replace(/\s+permanently\.?$/i, '').trim();
  let m: RegExpMatchArray | RegExpExecArray | null;
  if ((m = t.match(/\s+(twice|thrice|\d+ times)$/i))) {
    o.times = numW(m[1]!);
    t = t.slice(0, m.index);
  }
  if ((m = t.match(/^(.*?)\s+per\s+(.+)$/i))) {
    t = m[1]!;
    o.per = m[2]!.trim();
  }
  if (/equal to this item's multicast/i.test(t)) {
    o.eqMc = true;
    return o;
  }
  const re = /\+?(\d+(?:\.\d+)?)\s*%?\s*(?:bonus\s+)?(damage|dmg|burn|poison|bleed|shock|shield|heal|multicast|crit chance|crit)\b/gi;
  let any = false;
  while ((m = re.exec(t))) {
    const k = STAT[m[2]!.toLowerCase()]!;
    o.stats[k] = (o.stats[k] || 0) + parseFloat(m[1]!);
    any = true;
  }
  if ((m = t.match(/(\d+|a|an) random debuffs?/i))) {
    o.rand = num(m[1]!);
    any = true;
  }
  o.ok = any;
  return o;
}

function parseTriggerTarget(r: string, st: ParseState): Act | null {
  let times = 1,
    extra = false,
    inf = false,
    t = r.trim(),
    m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+ times?|twice|thrice)$/i))) return { k: 'trig', target: { t: 'self' }, times: numW(m[1]!) };
  if (
    (m = t.match(/^(.*?)\s*(an extra time|an additional time|(\d+) (?:extra|additional) times?|twice|thrice|infinitely|(\d+) times?)$/i))
  ) {
    t = m[1]!;
    const w = m[2]!.toLowerCase();
    if (w === 'infinitely') inf = true;
    else if (/extra|additional/.test(w)) {
      extra = true;
      times = m[3] ? +m[3] : 1;
    } else times = m[4] ? +m[4] : num(w);
  }
  t = t.trim();
  if ((m = t.match(/^(?:another|(\d+|an?)) (?:other )?random (\w+?)s?$/i)) || (m = t.match(/^(\d+) other random (\w+?)s?$/i))) {
    return { k: 'trigRand', n: m[1] && !/^another$/i.test(m[1]) ? num(m[1]) : 1, type: normType(m[2]!) };
  }
  const target = parseTarget(t || 'this', st);
  if (!target) return null;
  st.last = target;
  return { k: 'trig', target, times, extra, inf };
}

function parseClause(c0: string, st: ParseState): Act | null {
  let c = c0.trim().replace(/^then\s+/i, '');
  let cond: Cond | null = null,
    m: RegExpMatchArray | null;
  if ((m = c.match(/^if (.+?),\s*(.+)$/i))) {
    cond = parseCond(m[1]!);
    if (!cond) return null;
    c = m[2]!;
  }
  const l = c.toLowerCase();
  let act: Act | null = null;

  if ((m = l.match(/^trigger poison damage on enemy(?: (twice|thrice|\d+ times))?$/))) act = { k: 'poisonTick', n: m[1] ? numW(m[1]) : 1 };
  else if ((m = l.match(/^trigger (a|an|\d+) shock stacks? on enemy$/))) act = { k: 'shockTick', n: num(m[1]!) };
  else if ((m = l.match(/^trigger your items' start of combat effects(?: (twice|thrice|\d+ times))?$/)))
    act = { k: 'triggerSoc', n: m[1] ? numW(m[1]) : 1 };
  else if ((m = l.match(/^trigger your (?:dark|\w+) items(?: (twice|thrice|\d+ times))?(?: \(.*\))?$/)) && /dark items/.test(l)) {
    act = { k: 'trig', target: { t: 'group', other: false, type: 'dark', excludeName: 'dark necklace' }, times: m[1] ? numW(m[1]) : 1 };
  } else if ((m = l.match(/^trigger (.+)$/))) act = parseTriggerTarget(m[1]!, st);
  else if (
    (m = l.match(
      /^(?:permanently )?gain (that much|twice that much|twice that amount|twice the amount)(?: as)? (?:bonus )?(shield|damage)/,
    ))
  )
    act = { k: 'gainCtx', mult: /twice/.test(m[1]!) ? 2 : 1, stat: STAT[m[2]!] };
  else if ((m = l.match(/^(?:permanently )?gain \+?(\d+) max (?:health|hp)/))) act = { k: 'maxhp', n: +m[1]! };
  else if ((m = l.match(/^deal (\d+) (?:bonus )?damage$/))) act = { k: 'deal', n: +m[1]! };
  else if ((m = l.match(/^deal bonus damage equal to (?:(\d+)x |(twice) )?crit chance$/)))
    act = { k: 'dealCrit', mult: m[1] ? +m[1] : m[2] ? 2 : 1 };
  else if ((m = l.match(/^(?:apply|inflict) (\d+) (bleed|poison|burn|shock)\b/))) act = { k: 'apply', stat: m[2]!, n: +m[1]! };
  else if ((m = l.match(/^lifesteal (?:an additional time|(\d+) additional times|(twice|thrice))$/)))
    act = { k: 'lifesteal', n: m[1] ? +m[1] : m[2] ? num(m[2]) : 1 };
  else if ((m = l.match(/^(\d+)% chance to apply \+(\d+) (bleed|poison|burn|shock)$/)))
    act = { k: 'chanceApply', p: +m[1]! / 100, stat: m[3]!, n: +m[2]! };
  else if ((m = l.match(/^cleanse (\d+)% of your debuffs$/))) act = { k: 'cleanse', pct: +m[1]! };
  else if ((m = l.match(/^cleanse (\d+) of (?:each debuff|it|all debuffs)$/))) act = { k: 'cleanse', n: +m[1]! };
  else if ((m = l.match(/^shield for (\d+)$/))) act = { k: 'shield', n: +m[1]! };
  else if ((m = l.match(/^shield equal to (\d+)% of your max hp$/))) act = { k: 'shield', pctMax: +m[1]! };
  else if ((m = l.match(/^destroy (\d+)% of enemy shield$/))) act = { k: 'destroyShield', pct: +m[1]! };
  else if ((m = l.match(/^(?:permanently )?increase (?:your )?shock damage by \+?(\d+)$/))) act = { k: 'shockDmg', n: +m[1]! };
  else if ((m = l.match(/^(?:permanently )?reduce cooldown by ([\d.]+)s(?: per (.+))?$/)))
    act = { k: 'cdAdd', sec: -parseFloat(m[1]!), per: m[2] || null };
  else if ((m = l.match(/^reduce cooldown to ([\d.]+) seconds?$/))) act = { k: 'cdSet', sec: parseFloat(m[1]!) };
  else if ((m = l.match(/^increase this item's cooldown by ([\d.]+)s$/))) act = { k: 'cdAdd', sec: parseFloat(m[1]!), noFloor: true };
  else if ((m = l.match(/^(?:permanently )?set item above's cooldown to ([\d.]+)s$/)))
    act = { k: 'cdSetT', target: { t: 'dir', dir: DIRS.above, type: '' }, sec: parseFloat(m[1]!) };
  else if ((m = l.match(/^(?:permanently )?reduce (.+?)'s cooldown by (\d+)%$/))) {
    const tg = parseTarget(m[1]!, st);
    act = tg ? { k: 'cdPct', target: tg, pct: +m[2]! } : null;
  } else if ((m = l.match(/^remove ([\d.]+)s current cooldown from (.+)$/))) {
    const tg = parseTarget(m[2]!, st);
    act = tg ? { k: 'cdCur', target: tg, sec: parseFloat(m[1]!) } : null;
  } else if ((m = l.match(/^remove ([\d.]+) seconds? from this item's current cooldown$/)))
    act = { k: 'cdCur', target: { t: 'self' }, sec: parseFloat(m[1]!) };
  else if ((m = l.match(/^reduce current cooldown of (.+?) by ([\d.]+)s$/))) {
    const tg = parseTarget(m[1]!, st);
    act = tg ? { k: 'cdCur', target: tg, sec: parseFloat(m[2]!) } : null;
  } else if ((m = l.match(/^give (.+?) bonus damage equal to (?:(twice|\d+ times|(\d+)x) )?their crit chance$/))) {
    const tg = parseTarget(m[1]!, st);
    act = tg ? { k: 'giveCritDmg', target: tg, mult: m[2] ? (m[2] === 'twice' ? 2 : parseInt(m[2])) : 1 } : null;
  } else if (
    /^(?:permanently )?transfer (?:(\d+)x |(\d+)x )?this item's crit chance to another item to the right$/.test(l) ||
    /^(?:permanently )?transfer (\w+) this item's crit chance to another item to the right$/.test(l) ||
    /^(?:permanently )?transfer this item's crit chance to another item to the right$/.test(l)
  ) {
    act = { k: 'transferCrit', mult: 1 };
    const mm = l.match(/transfer (\d+)x/);
    if (mm) act.mult = +mm[1]!;
  } else if ((m = l.match(/^(?:permanently )?give (\d+)x this item's crit chance to another item to the right$/)))
    act = { k: 'transferCrit', mult: +m[1]!, copy: true };
  else if (/^(?:permanently )?give (.+?) a random debuff$/.test(l) || /^(?:permanently )?give (.+?) (\d+) random debuffs$/.test(l)) {
    const mm = l.match(/^(?:permanently )?give (.+?) (?:(\d+) |a )random debuffs?$/)!;
    const tg = parseTarget(mm[1]!, st);
    if (tg) {
      st.last = tg;
      act = { k: 'give', target: tg, stats: {}, rand: mm[2] ? +mm[2] : 1, per: null, times: 1 };
    }
  } else if ((m = l.match(/^(?:permanently )?give (.+?)\s+((?:\+|\d|a random).*)$/))) {
    const tg = parseTarget(m[1]!, st);
    const so = parseStats(c.slice(c.toLowerCase().indexOf(m[2]!.toLowerCase())));
    if (tg && so.ok) {
      st.last = tg;
      act = { k: 'give', target: tg, stats: so.stats, rand: so.rand, per: so.per, times: so.times };
    }
  } else if (/^(?:permanently )?gain (.+)$/.test(l)) {
    const so = parseStats(c.replace(/^(?:permanently )?gain\s+/i, ''));
    if (so.eqMc) act = { k: 'gainEq', stat: /shield/.test(l) ? 'block' : 'dmg' };
    else if (so.ok) act = { k: 'gain', stats: so.stats, rand: so.rand, per: so.per, times: so.times };
  }
  if (!act) return null;
  if (cond) act.cond = cond;
  return act;
}

type Head = Omit<Effect, 'acts'>;
const TIMINGS: [RegExp, (m: RegExpMatchArray) => Head[]][] = [
  [/^start of combat and on trigger:\s*/i, () => [{ ev: 'soc' }, { ev: 'trig' }]],
  [/^on trigger and start of combat:\s*/i, () => [{ ev: 'soc' }, { ev: 'trig' }]],
  [/^start of combat:\s*/i, () => [{ ev: 'soc' }]],
  [/^start of day:\s*/i, () => [{ ev: 'sod' }]],
  [/^on first (\d+) triggers:\s*/i, (m) => [{ ev: 'trig', first: +m[1]! }]],
  [/^on first trigger:\s*/i, () => [{ ev: 'trig', first: 1 }]],
  [/^every (\d+) triggers:\s*/i, (m) => [{ ev: 'trig', every: +m[1]! }]],
  [/^on crit:\s*/i, () => [{ ev: 'critSelf' }]],
  [/^(?:whenever|when) this crits?,?\s*/i, () => [{ ev: 'critSelf' }]],
  [/^(?:whenever|when) (?:an item|you|any item) crits?,?\s*/i, () => [{ ev: 'critAny' }]],
  [/^when you apply (?:a )?debuff,?\s*/i, () => [{ ev: 'applyDebuff' }]],
  [/^when you apply burn,?\s*/i, () => [{ ev: 'applyBurn' }]],
  [/^when another item applies bleed,?\s*/i, () => [{ ev: 'bleedOther' }]],
  [/^when another item heals,?\s*/i, () => [{ ev: 'healOther' }]],
  [/^whenever you heal,?\s*/i, () => [{ ev: 'heal' }]],
  [/^(?:whenever|when) you gain shield,?\s*/i, () => [{ ev: 'shieldGain' }]],
  [/^when poison triggers on enemy,?\s*/i, () => [{ ev: 'poisonTick' }]],
  [/^when shock triggers on enemy,?\s*/i, () => [{ ev: 'shockTick' }]],
  [/^whenever an? (\w+) item triggers,?\s*/i, (m) => [{ ev: 'trigOther', filter: { type: sing(m[1]!), allowSelf: true } }]],
  [/^when another (\w+?)(?: item)? triggers?,?\s*/i, (m) => [{ ev: 'trigOther', filter: { type: sing(m[1]!), allowSelf: false } }]],
  [/^when another item lifesteals,?\s*/i, () => [{ ev: 'lifestealOther' }]],
  [
    /^when another item to the (left|right) triggers,?\s*/i,
    (m) => [{ ev: 'trigOther', filter: { type: '', allowSelf: false, side: m[1]!.toLowerCase() as 'left' | 'right' } }],
  ],
  [/^(?:whenever|when) you lifesteal,?\s*/i, () => [{ ev: 'lifesteal' }]],
  [/^on trigger:\s*/i, () => [{ ev: 'trig' }]],
];

function splitClauses(rest: string): string[] {
  return rest.split(/\s+and\s+(?=(?:trigger|gain|give|apply|inflict|deal|permanently|reduce|cleanse|shield|increase|\d+% chance)\b)/i);
}

function parseSentence(s: string, out: ParsedAbility): void {
  s = s.trim();
  if (!s) return;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^when the enemy reaches (\d+)% hp or less, instantly execute them/i))) {
    out.effects.push({ ev: 'enemyLow', pct: +m[1]!, acts: [{ k: 'execute' }] });
    return;
  }
  if ((m = s.match(/^this (?:item )?applies (debuffs|poison|burn|bleed|shock)(?: (\d+) times| (twice))/i))) {
    out.statics.push({ s: 'applyTimes', stat: m[1]!.toLowerCase(), n: m[2] ? +m[2] : 2 });
    return;
  }
  if ((m = s.match(/^increases critical strike effect from 2x to ([\d.]+)x/i))) {
    out.statics.push({ s: 'critMult', v: parseFloat(m[1]!) });
    return;
  }
  if ((m = s.match(/^burn ticks (\d+)% faster/i))) {
    out.statics.push({ s: 'burnFaster', v: +m[1]! / 100 });
    return;
  }
  if ((m = s.match(/^shock triggers? (twice|thrice|\d+ times|instantly)/i))) {
    out.statics.push({ s: 'shockTimes', v: /instantly/i.test(m[1]!) ? 5 : numW(m[1]!) });
    return;
  }
  if ((m = s.match(/^your start of combat effects trigger (an extra time|(\d+) extra times)/i))) {
    out.statics.push({ s: 'socExtra', v: m[2] ? +m[2] : 1 });
    return;
  }
  if ((m = s.match(/^this lifesteals (\d+) times|^this lifesteals (twice|thrice)/i))) {
    out.statics.push({ s: 'lifestealTimes', n: m[1] ? +m[1] : num(m[2]!) });
    return;
  }
  if ((m = s.match(/^your lifesteal grants (\d+)% as permanent max health/i))) {
    out.statics.push({ s: 'lifestealMaxHp', v: +m[1]! / 100 });
    return;
  }
  if (/^every \d+ triggers of item below|^on every trigger of item below/i.test(s)) {
    out.unparsed.push(s);
    return;
  }
  let heads: Head[] | null = null,
    rest = s;
  if ((m = s.match(/^(.*?)\s+(?:whenever|when)\s+(?:you\s+)?us(?:e|ing)\s+a\s+potion(\s+on\s+this)?$/i))) {
    heads = [{ ev: m[2] ? 'potionSelf' : 'potionAny' }];
    rest = m[1]!;
  } else if (IGNORE.test(s)) {
    out.ignored.push(s);
    return;
  }
  if (!heads)
    for (const [re, fn] of TIMINGS) {
      const mm = s.match(re);
      if (mm) {
        heads = fn(mm);
        rest = s.slice(mm[0].length);
        break;
      }
    }
  if (!heads) {
    out.unparsed.push(s);
    return;
  }
  const st: ParseState = { last: null };
  const acts: Act[] = [];
  let bad = false;
  for (const c of splitClauses(rest)) {
    const a = parseClause(c, st);
    if (a) acts.push(a);
    else bad = true;
  }
  if (bad && !acts.length) {
    out.unparsed.push(s);
    return;
  }
  if (bad) out.partial = true;
  for (const h of heads) out.effects.push(Object.assign({}, h, { acts }));
}

const cache = new Map<string, ParsedAbility>();

/** Parse one ability text (cached). */
export function parseAbility(text: string | null | undefined): ParsedAbility {
  if (text == null) return { effects: [], statics: [], unparsed: [], ignored: [], none: true };
  const hit = cache.get(text);
  if (hit) return hit;
  const out: ParsedAbility = { effects: [], statics: [], unparsed: [], ignored: [], partial: false, none: false };
  const t = text
    .replace(/\([^)]*\)/g, '')
    .replace(/\[\[|\]\]/g, '')
    .replace(/\.{2,}/g, '.')
    .trim();
  t.split(/\.\s+|\.$/).forEach((s) => parseSentence(s.replace(/\.$/, ''), out));
  cache.set(text, out);
  return out;
}

/** ability text for a given star (explicit null = no ability, short array reuses the last known text) */
export function abilityText(def: Pick<ItemDef, 'ab'>, star: number): string | null {
  const a = def.ab;
  if (star < a.length) return a[star] ?? null;
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]!;
  return null;
}

/** 'full' | 'partial' | 'stats' (has an ability text but nothing simulated) | 'none' */
export function coverage(def: Pick<ItemDef, 'ab'>, star: number): Coverage {
  const txt = abilityText(def, star);
  if (txt == null) return 'none';
  const p = parseAbility(txt);
  const sim = p.effects.length + p.statics.length;
  if (!sim) return 'stats';
  return p.unparsed.length || p.partial ? 'partial' : 'full';
}
