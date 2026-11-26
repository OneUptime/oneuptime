import { SecurityCaseStepCheckSentence } from "../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import { TemplateValues, Translator } from "../../../Types/Translator";
import {
  WrittenMoment,
  getMomentRole,
  momentPhrase,
} from "../../MomentPhrases";

/*
 * A sentence of a step check's evidence in a reader's words (#10340): its
 * key looked up in their language, its figures in their digits, its
 * moments written as the caller writes one - the card on the reader's
 * clock, the server's timeline and messages in a zone they name - and its
 * values as they are.
 *
 * A moment brings its own words (#10622, Utils/MomentPhrases): "at 14:25"
 * today, "on 27 Nov at 14:25" on another day, by the part its placeholder
 * plays - {{since}} since when, {{until}} until when, any other when.
 */

/*
 * The sentences as the checks wrote them before #10622, with the
 * preposition before their moment: a check's row written then keeps its
 * sentence until the step is checked again, and a closed case's for good.
 * Their moments go in as one text, as they always did - a phrase after
 * their own "at" would read "at at 14:25". No sentence joins this list.
 */
export const STEP_CHECK_SENTENCES_BEFORE_MOMENT_PHRASES: ReadonlySet<string> =
  new Set<string>([
    "No request from {{address}} has reached your app since {{since}}. It sent {{count}} in the hour before.",
    "{{address}} still reaches your app: {{count}} requests in the last 30 minutes, the latest at {{latest}}.",
    "{{address}} got through again at {{time}}: the block is not holding.",
    "{{count}} requests from {{address}} have reached your app since {{time}}.",
    "No request from {{address}} has reached your app since {{since}}.",
    "{{address}} is blocked at {{destination}} since {{since}}, last confirmed {{confirmed}}.",
    "{{address}} is challenged at {{destination}} since {{since}}, last confirmed {{confirmed}}.",
    "{{range}}, which holds {{address}}, is blocked at {{destination}} since {{since}}, last confirmed {{confirmed}}.",
    "{{range}}, which holds {{address}}, is challenged at {{destination}} since {{since}}, last confirmed {{confirmed}}.",
    "Cloudflare has stopped {{count}} requests from {{address}} since the block at {{time}}.",
    "Cloudflare has stopped about {{count}} requests from {{address}} since the block at {{time}}.",
    "Cloudflare has challenged {{count}} requests from {{address}} since the challenge at {{time}}.",
    "Cloudflare has challenged about {{count}} requests from {{address}} since the challenge at {{time}}.",
    "Counted since {{time}}, when the case's first detection began.",
    "{{user}} is suspended in {{provider}} (since {{since}}).",
    "{{user}} is disabled in {{provider}}, and their sessions were ended at {{since}}.",
    "{{value}} is blocked on every machine with {{destination}} since {{since}}, until {{until}}.",
    "{{value}} is blocked on every machine with {{destination}} since {{since}}, until someone lifts it.",
    "The block on {{value}} ended at {{time}}, so your machines no longer block it.",
    "Since {{change}} shipped at {{time}}, all {{count}} attack requests to {{route}} were turned away.",
    "Since {{change}} shipped at {{time}}, none of the {{count}} attack requests to {{route}} reached the database.",
    "No attempts on {{route}} since {{change}} shipped at {{time}}.",
    "{{through}} of the {{count}} attack requests to {{route}} since {{change}} shipped at {{time}} got past your app's checks.",
    "{{through}} of the {{count}} attack requests to {{route}} since {{change}} shipped at {{time}} reached the database.",
    "An attack request to {{route}} got past your app's checks at {{time}}, after {{change}} shipped: the fix is not holding.",
    "An attack request to {{route}} reached the database at {{time}}, after {{change}} shipped: the fix is not holding.",
    "The fix {{pullRequest}} merged at {{time}}, but OneUptime has seen no deploy of it yet.",
    "Watching {{route}} until {{until}}: verified once {{count}} attack requests are turned away.",
    "Watching {{route}} until {{until}}: verified once {{count}} attack requests are kept out of the database.",
    "OneUptime watched {{route}} until {{until}}, and too few attacks came to verify the fix.",
    "{{user}}'s password was changed in {{provider}} at {{time}}, and their sessions were ended at {{ended}}.",
    "{{user}}'s password was changed in {{provider}} at {{time}}, but their sessions were not ended after the case opened.",
  ]);

// A sentence's key: the template, or a plural one's general form.
export function getStepCheckSentenceKey(
  template: SecurityCaseStepCheckSentence["template"],
): string {
  return typeof template === "string" ? template : template.other;
}

// Whether a sentence names its moments with its own preposition (written before #10622).
export function isSentenceBeforeMomentPhrases(
  template: SecurityCaseStepCheckSentence["template"],
): boolean {
  return STEP_CHECK_SENTENCES_BEFORE_MOMENT_PHRASES.has(
    getStepCheckSentenceKey(template),
  );
}

export function wordStepCheckSentence(data: {
  sentence: SecurityCaseStepCheckSentence;
  translator: Translator;
  writeMoment: (time: Date) => WrittenMoment;
}): string {
  const values: TemplateValues = { ...data.sentence.values };
  const isBeforePhrases: boolean = isSentenceBeforeMomentPhrases(
    data.sentence.template,
  );

  for (const [key, number] of Object.entries(data.sentence.numbers || {})) {
    values[key] = data.translator.formatNumber(number);
  }

  for (const [key, time] of Object.entries(data.sentence.times || {})) {
    const moment: Date = new Date(time);

    if (Number.isNaN(moment.getTime())) {
      continue;
    }

    const written: WrittenMoment = data.writeMoment(moment);

    values[key] = isBeforePhrases
      ? written.whole
      : momentPhrase(getMomentRole(key), written);
  }

  return typeof data.sentence.template === "string"
    ? data.translator.translateTemplate(data.sentence.template, values)
    : data.translator.translatePlural(
        data.sentence.template,
        data.sentence.count || 0,
        values,
      );
}
