import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A span of time as Security Events says one in a sentence: a rule's
 * timespan ("Fires when ... within 10 minutes"), how far back a rule looks,
 * how long security events are kept. In its largest whole unit, in the
 * translator's language.
 *
 * React-free, so the models that word these sentences can use it.
 */

const TIMESPAN_UNITS: Array<{
  seconds: number;
  plural: { one: string; other: string };
}> = [
  {
    seconds: 7 * 24 * 60 * 60,
    plural: { one: "{{count}} week", other: "{{count}} weeks" },
  },
  {
    seconds: 24 * 60 * 60,
    plural: { one: "{{count}} day", other: "{{count}} days" },
  },
  {
    seconds: 60 * 60,
    plural: { one: "{{count}} hour", other: "{{count}} hours" },
  },
  {
    seconds: 60,
    plural: { one: "{{count}} minute", other: "{{count}} minutes" },
  },
  {
    seconds: 1,
    plural: { one: "{{count}} second", other: "{{count}} seconds" },
  },
];

// A timespan in its largest whole unit: "10 minutes", "2 weeks".
export function formatTimespan(
  seconds: number,
  translator: Translator,
): string {
  for (const unit of TIMESPAN_UNITS) {
    if (seconds >= unit.seconds && seconds % unit.seconds === 0) {
      return translator.translatePlural(unit.plural, seconds / unit.seconds);
    }
  }

  return translator.translatePlural(
    { one: "{{count}} second", other: "{{count}} seconds" },
    seconds,
  );
}
