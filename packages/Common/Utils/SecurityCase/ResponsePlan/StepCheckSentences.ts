import { SecurityCaseStepCheckSentence } from "../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import { Translator } from "../../../Types/Translator";

/*
 * A sentence of a step check's evidence in a reader's words (#10340): its
 * key looked up in their language, its figures in their digits, its times
 * written as the caller writes a time - the card on the reader's clock, the
 * server's timeline and messages in a zone they name - and its values as
 * they are.
 */
export function wordStepCheckSentence(data: {
  sentence: SecurityCaseStepCheckSentence;
  translator: Translator;
  writeTime: (time: Date) => string;
}): string {
  const values: Record<string, string> = { ...data.sentence.values };

  for (const [key, number] of Object.entries(data.sentence.numbers || {})) {
    values[key] = data.translator.formatNumber(number);
  }

  for (const [key, time] of Object.entries(data.sentence.times || {})) {
    const moment: Date = new Date(time);

    if (!Number.isNaN(moment.getTime())) {
      values[key] = data.writeTime(moment);
    }
  }

  return typeof data.sentence.template === "string"
    ? data.translator.translateTemplate(data.sentence.template, values)
    : data.translator.translatePlural(
        data.sentence.template,
        data.sentence.count || 0,
        values,
      );
}
