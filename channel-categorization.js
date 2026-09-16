// ===========================================================================
// CHANNEL CATEGORIZATION — self-reported free-text → channel bucket
// ===========================================================================
// Ported verbatim from mutiny_growth_dashboard.jsx (as of 2026-09-15).
//
// WHAT THIS DOES
//   Takes a raw, self-reported "how did you hear about us?" free-text string
//   and resolves it to exactly one of 9 channel buckets. This is the SAME
//   engine that drives BOTH dashboard charts:
//     • "User Signups by channel"          — input = Amplitude referral_source
//     • "Sales meeting requests by channel" — input = HubSpot contact property
//                                             how_did_you_discover_mutiny
//                                             (the Talk-to-Sales form field)
//   Nothing about the logic is meeting-specific. To reuse it, just feed your
//   own free-text field into categorizeReferralSource().
//
// HOW IT RESOLVES A STRING (the algorithm)
//   1. Normalize: lowercase, trim, collapse whitespace, and if the response is
//      a URL, prepend the host so "https://www.linkedin.com/in/x" still matches
//      the LinkedIn rule (see normalizeReferralSource).
//   2. Walk CATEGORIZATION_RULES top-to-bottom. FIRST regex that matches wins.
//      → Order is the whole game. More specific / higher-priority patterns sit
//        above generic ones so they claim the response first.
//   3. Empty/whitespace input, or nothing matched → 'Other / Unparseable'.
//
// WHY THE ORDER IS WHAT IT IS (the non-obvious precedence decisions)
//   • Influencer/Community named signals (30MPC, MKT1, podcasts…) are checked
//     FIRST, so "LinkedIn - 30mpc" or "30MPC co-brand email" lands in
//     Influencer even though it also names LinkedIn / email.
//   • LinkedIn is folded INTO Social, but matched BEFORE Word of Mouth, so
//     "LinkedIn post from a friend" stays Social instead of falling to WoM.
//   • Email is checked BEFORE Word of Mouth / Search / Social, so "newsletter"
//     and any "email" mention are pulled out of those buckets into Email.
//   • Search's generic terms (google, "looking for", online) sit below the
//     branded/social/email rules so a more specific channel wins first.
//   • Joke/Invalid is LAST so it only catches responses nothing real matched.
//
// THE 9 BUCKETS (a value is ALWAYS assigned; there is no "uncategorized"):
//   Word of Mouth · Search · AEO · Influencer / Community · YC · Social ·
//   Email · Joke / Invalid · Other / Unparseable
// ===========================================================================

// Known employer/customer mentions that indicate "heard from coworkers at this
// company" — bucketed as Word of Mouth. Grows over time as new employer-mention
// patterns appear in raw data.
const KNOWN_EMPLOYER_MENTIONS = /^(BMC|Homebase|Slack|calm|sequoia|Team|SWI|Airwallex|Apollo\s?IO?|Builtwith|Exadel|Octave|tennr|Samsara)$|we use it at|use(d)?\s?(it)?\s?at|previous\s?role|previous\s?company|usage\s?in|worked?\s?with|evaluated\s?in/i;

// Smart inference rules. Each rule's regex runs against the NORMALIZED response.
// Order matters: first match wins (see categorizeReferralSource). Patterns are
// built to tolerate typos, casing, spacing, multi-language, and URL forms.
const CATEGORIZATION_RULES = [
  // ── 1. Influencer / Community — HIGH-PRIORITY named signals, checked FIRST
  //       so "any mention of" these wins even when the response also names a
  //       platform/channel. Covers 30MPC + misspellings (30mpc, 30 mpc, 30M2PC,
  //       "30 Mins", "30 mins to…"), any podcast, MKT1, Emily Kramer, Crew.
  { match: /30\s?m\s?[0-9]?\s?p\s?c|30\s?mins?\b|30x\s?sales|podcast|\bmkt\s?1\b|emily\s?kramer|\bcrew\b/i,
    bucket: 'Influencer / Community' },

  // ── 2. LinkedIn → Social. Folded into Social, but matched HERE (ahead of
  //       Word of Mouth / Search) so "LinkedIn post from a friend" stays Social.
  //       Name OR linkedin.com domain, any casing/spacing.
  { match: /linked[\s-]?in|linkedin\.com/i, bucket: 'Social' },

  // ── 3. AEO — AI search/chat engines & their URLs. chatgpt, chat gpt, claude
  //       (incl. claude.ai/.com), gpt, perplexity, gemini, copilot (co-pilot,
  //       co pilot), bare "ai", "llm".
  { match: /chat\s?gpt|\bgpt\b|claude(\.ai|\.com)?|perplexity|gemini|co[-\s]?pilot|\bai\b|\bllm\b/i, bucket: 'AEO' },

  // ── 4. YC — Y Combinator and its internal community (Bookface).
  { match: /y\s?combinator|\byc\b|bookface/i, bucket: 'YC' },

  // ── 5. Influencer / Community — broader community / course / content signals
  //       (checked after the high-priority named signals above).
  { match: /\bhbs\b|alumni|community|\bjaleh\b|wes\s?bush|joel\s?klettke|patrick\s?collins|inbound\s?conference|\bwebinar\b|\bacademy\b|long\s?time\s?listener|^content$|par\s?une\s?formation/i,
    bucket: 'Influencer / Community' },

  // ── 6. Email — any email mention (incl. typos emial / emai, e-mail, bare
  //       "mail") or newsletter. Checked BEFORE Word of Mouth / Search / Social
  //       so it pulls email + newsletter out of those buckets into its own.
  { match: /e[\s-]?mail|emial|emai\b|news\s?letter|netsletter|^news$|\bmail\b/i, bucket: 'Email' },

  // ── 7. Word of Mouth — peer/colleague/client recommendations, employer
  //       mentions, family/personal references, multi-language equivalents,
  //       and "someone mentioned it" phrasings. AFTER LinkedIn so
  //       "LinkedIn post from someone" stays Social.
  //       Typos: `colleg` stem → colleague/collegues/collegaue; `refer` stem →
  //       referred/referral/referal/refferal/recc/refers.
  //       Multi-language: passaparola (it), indicação (pt).
  //       NOTE: "newsletter" was removed from this rule — it now routes to Email.
  { match: new RegExp(
      /friend|amigos?|colleagu|colleg(au|ue|e)|co[-\s]?worker|\bclients?\b|\bcustomer\b|\bteammate\b|\bcousin\b|\bre[fF]+er|\brecc\b|recommen|recomman|word.?of.?mouth|\bwom\b|\bmanager\b|\bmentor\b|\bteacher\b|\bemployee\b|\bnetwork\b|\bvendor\b|\brep\b|rippling|\bceo\b|\bvp\b|\bboss\b|\bfan\b|\bbuddy\b|\bhubby\b|\bwife\b|\bhusband\b|\bspouse\b|\binvestor\b|\bruben\b|\bnikhil\b|\belijah\b|\bawoke\b|\blexi\b|sam\s?gong|previous\s?customer|previous\s?workplace|past\s?role|already\s?used\s?it|used\s?it\b|consultant|advisor|\bfounder\b|\bboard\b|cowboy\s?ventures|passaparola|indicaç|mention(ed|ing|s)?\b|my\s?(ae|coworker|boss|hubby|manager|wife|husband|teammate|bosses)|^work$|^at\s?work$|work(ing|ed)?\s?with|^company$|^company\s?profile$|^business$|^marketing(\s?lead)?$|^another\s?competitor$|^other\s?company$|from\s?job\s?boards?|^job\s?boards?$|interview|peer|industry/.source
      + '|' + KNOWN_EMPLOYER_MENTIONS.source, 'i'),
    bucket: 'Word of Mouth' },

  // ── 8. Search — Google/web/internet/organic + generic "looking for" intent +
  //       SEO/research-style phrasings.
  { match: /google|googl|\bsearch\b|^web$|web\s?search|^organic$|online|internet|^www$|\bseo\b|looking\s?for|\bresearch\b|^website$/i,
    bucket: 'Search' },

  // ── 9. Social — all major platforms + Substack + bare "social" /
  //       "social media". LinkedIn also folds in here (see rule 2).
  { match: /\bx post\b|^x$|x\.com|twitter|reddit|facebook|^fb$|^fb\b|instagram|\binsta\b|youtube|^yt$|\byt\b|tiktok|tik\s?tok|snapchat|pinterest|threads|bluesky|mastodon|substack|social\s?media|^socials?$|^li$|\bli post\b/i,
    bucket: 'Social' },

  // ── 10. Joke / Invalid — fate/destiny variants, test entries, blanks, short
  //        random strings, obvious jokes, "I don't know" equivalents. Keeps the
  //        Other bucket meaningful. Vague-but-real responses ("Marketing",
  //        "business") fall THROUGH to Other rather than getting buried here.
  { match: /\bfate\b|\bdestiny\b|\bluck\b|^test|\btesting\b|^demo$|^trining$|\bidk\b|^jk$|^it$|^try$|^omar$|^dj\s?khaled$|^sfasf$|^hello$|^\.+$|^-+$|^\d{1,2}$|^n\/?a$|^na$|^tbd$|^dunno$|^date$|^spam$|^myself$|^my\s?meta\s?data$|i didn'?t|i was so excited|don'?t remember|pressured me into|its blowing up|my neighbors|home\s?boy|20 year marketing|\bloved it\b|wizard.*alley|raccoon|can'?t remember|^(aa+|gg+|ff+|das|sds|ifif|f|asd|sda|cyes|da|vv|wqe|qq|xxgdfgfd|nunya)$/i,
    bucket: 'Joke / Invalid' },
];

// Normalize a raw response for matching: lowercase, trim, extract URL host (so
// "https://www.linkedin.com/in/..." matches the LinkedIn rule), collapse space.
function normalizeReferralSource(raw) {
  if (!raw) return '';
  let s = String(raw).toLowerCase().trim();
  const urlMatch = s.match(/https?:\/\/(?:www\.)?([^\s/]+)/);
  if (urlMatch) s = urlMatch[1] + ' ' + s; // prepend host so rules still see context
  return s.replace(/\s+/g, ' ');
}

// Resolve one raw free-text response → one bucket name. First match wins.
function categorizeReferralSource(raw) {
  if (!raw) return 'Other / Unparseable';
  const normalized = normalizeReferralSource(raw);
  if (!normalized) return 'Other / Unparseable';
  for (const rule of CATEGORIZATION_RULES) {
    if (rule.match.test(normalized)) return rule.bucket;
  }
  return 'Other / Unparseable';
}

// The 9 buckets, in dashboard legend order. Colors are Mutiny-brand tokens in
// the dashboard; swap for your own project.
const BUCKET_DEFINITIONS = [
  { name: 'Word of Mouth' },
  { name: 'Search' },
  { name: 'AEO' },
  { name: 'Influencer / Community' },
  { name: 'YC' },
  { name: 'Social' },
  { name: 'Email' },
  { name: 'Joke / Invalid' },
  { name: 'Other / Unparseable' },
];

export {
  KNOWN_EMPLOYER_MENTIONS,
  CATEGORIZATION_RULES,
  normalizeReferralSource,
  categorizeReferralSource,
  BUCKET_DEFINITIONS,
};

// ---------------------------------------------------------------------------
// USAGE
// ---------------------------------------------------------------------------
//   import { categorizeReferralSource } from './channel-categorization.js';
//
//   // Share-of-channel over a list of raw responses:
//   const responses = meetings.map(m => m.referralSource); // your free-text field
//   const counts = BUCKET_DEFINITIONS.map(def => ({
//     name: def.name,
//     value: responses.filter(r => categorizeReferralSource(r) === def.name).length,
//   }));
// ---------------------------------------------------------------------------
