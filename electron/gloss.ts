import type { Definition } from "../src/types";
import type { GlossMap } from "../src/gloss";

// The packaged ECDICT subset does not retain CET/frequency tags. This is a
// deliberately conservative long-word/common-word heuristic, not a CET-6 list.
// Both surface forms and dictionary lemmas are checked against this fallback.
// When a newer dictionary supplies frequency/exam metadata, common entries are
// additionally suppressed. We never infer a precise exam level from word length.
const commonWords = new Set(`
accept accepted accepting 
actually address advance answer arrive arrange arrangements autumn
basic believe better birthday bought bring brought build building built
care careful carefully cause change changed changing check choose chosen
clean clear close collect collected coming common connect connected
create created creating current daily depend develop developed doing
early enough enter expect expected expecting family father feeling
finally finish finished fishing flying future give given going getting
health healthy hearing helpful history human improve improved improving
large later leave leaving listen listening living local looking matter
meeting modern money month months moving music named nature nearby
needed notice office order other outside parent parents paying person
place planning playing point policy public provide provided providing
raise reading real reason receive received receiving remain remained
return returned running school second seeing service services showing
simple simply sister social space speaking spend spent spring start
started starting staying still stopped stopping summer taking talking
teacher teachers teaching thank thinking thought through today travel
travelled traveled travelling traveling trying Tuesday Thursday until
using visit visited visiting waiting walking wanted wanting water
weekend welcome winter woman women working world writing written young
absolutely according afternoon afterwards agreement agreements although already
altogether another anything apartment apartments apparently available beautiful
because becoming beginning beginnings behaviour behavior boyfriend breakfast
broadcast broadcasts business businesses certainly character characters
children christmas classroom classrooms collection collections college
community communities companies company completely computer computers
condition conditions considered considering continue continued continues
conversation conversations countries country currently dangerous daughter
daughters decided decision decisions definitely department departments
described description development developments difference differences
different difficult difficulty direction directions discovered discussion
education educational effective effectively electric electrical electricity
especially essential established evening everybody everyone everything
everywhere excellent experience experienced experiences expensive explained
explanation following football foreign forgotten friend friends friendship
generally government governments grandmother grandfather great greatest
happening happiness themselves himself herself ourselves yourself yourselves
holiday holidays hospital hospitals however hundred hundreds important
importance including included includes increase increased increases
increasing individual individuals industry industrial information instead
interesting interested interest interests international internet interview
interviews introduced introduction immediately language languages knowledge
learning little location locations magazine magazines management manager
managers material materials medicine medical members membership mentioned
message messages million millions moment morning mother movement movements
national natural naturally necessary newspaper newspapers nothing November
October operation operations opportunity opportunities organization
organizations organisation organisations particular particularly people
perhaps performance personal personally picture pictures popular population
position positions possible possibly practice practices practical president
presidents probably problem problems produced production professional
professor programme programmes program programs property question questions
quickly recently recognize recognised recognized remember remembered
remembers relationship relationships reported reporter reporters reporting
required research researchers restaurant restaurants responsibility
responsible restaurant restaurants Saturday September situation situations
something sometimes somebody somewhere special specific statement statements
students student suddenly successful successfully support supported
supporting technology technologies telephone television temperature
themselves therefore together tomorrow traditional translation understand
understands understanding understood university universities usually various
vegetables Wednesday whatever whenever whether without wonderful yesterday
`.toLowerCase().split(/\s+/).filter(Boolean));

export const GLOSS_MAX_TEXT = 200_000;
export const GLOSS_MAX_WORDS = 1_200;

function shortChinese(translation: string): string {
  const first = translation
    .split(/\\n|[\r\n;；]/)
    .map((part) => part.trim())
    .find((part) => /[\u3400-\u9fff]/.test(part));
  if (!first) return "";
  const clean = first
    .replace(/^(?:(?:[a-z]+\.)+\s*)+/i, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .split(/[,，]/)[0]
    .trim();
  if (!/[\u3400-\u9fff]/.test(clean)) return "";
  const chars = Array.from(clean);
  return chars.length > 18 ? chars.slice(0, 18).join("") + "…" : clean;
}

/** No network, no AI and no changes to the original article or dictionary. */
export function buildGlosses(
  text: string,
  lookup: (word: string) => Definition,
): GlossMap {
  const result: GlossMap = {};
  const checked = new Set<string>();
  const tokens = text.slice(0, GLOSS_MAX_TEXT).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
  for (const token of tokens) {
    if (token.length < 9 || token.length > 60 || token !== token.toLowerCase()) continue;
    const word = token.replace(/’/g, "'");
    if (commonWords.has(word) || checked.has(word)) continue;
    if (checked.size >= GLOSS_MAX_WORDS) break;
    checked.add(word);
    const definition = lookup(word);
    if (!definition.found) continue;
    const tags = (definition.tag || "").toLowerCase().split(/[\s,;|]+/);
    const commonRank = [definition.bnc, definition.frq].some(
      (rank) => typeof rank === "number" && rank > 0 && rank <= 6000,
    );
    if (
      definition.oxford === 1 || commonRank ||
      tags.some((tag) => ["cet4", "cet6", "zk", "gk", "core"].includes(tag))
    ) continue;
    const lemma = definition.word.replace(/’/g, "'");
    if (
      lemma !== lemma.toLowerCase() ||
      !/^[a-z]+(?:['-][a-z]+)*$/.test(lemma) ||
      commonWords.has(lemma)
    ) continue;
    const translation = shortChinese(definition.translation);
    if (translation) result[word] = { lemma, translation };
  }
  return result;
}
