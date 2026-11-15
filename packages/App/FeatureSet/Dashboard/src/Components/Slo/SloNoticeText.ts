import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { SloNotice, SloNoticeFigure } from "Common/Utils/Slo/SloHealth";
import {
  formatSloNumber,
  formatSloPercent,
} from "Common/Utils/Slo/SloWidgetFormat";

/*
 * An SLO notice's words in the reader's language (#8446). SloHealth writes
 * every title, body and action label as a translation key, in English; the
 * banner looks each one up here, once. A body that states figures - "a
 * target must be greater than 0 and less than 100" - is worded from its
 * template, with each figure written the reader's way: "99,9" in German,
 * "۹۹٫۹" in Persian. React-free, so a test can hand it any locale.
 *
 * The title is not here: AlertBanner looks its title up itself, and looking
 * it up twice would translate a translation.
 */

// A figure the way the reader writes it: "100%", "100 %", "۱۰۰٪".
const writeFigure: (
  figure: SloNoticeFigure,
  translator: Translator,
) => string = (figure: SloNoticeFigure, translator: Translator): string => {
  const written: string | null = figure.isPercent
    ? formatSloPercent(figure.value, 3, translator)
    : formatSloNumber(figure.value, 3, translator);

  return written ?? String(figure.value);
};

export const getSloNoticeBodyInLanguage: (
  notice: SloNotice,
  translator: Translator,
) => string = (notice: SloNotice, translator: Translator): string => {
  if (notice.bodyTemplate && notice.bodyFigures) {
    const values: Record<string, string> = {};

    for (const [name, figure] of Object.entries(notice.bodyFigures)) {
      values[name] = writeFigure(figure, translator);
    }

    return translator.translateTemplate(notice.bodyTemplate, values, {
      setsValuesApart: true,
    });
  }

  return translator.translateText(notice.body) || notice.body;
};

// "Choose services", "Open Settings": the link that leads to the fix.
export const getSloNoticeActionLabelInLanguage: (
  notice: SloNotice,
  translator: Translator,
) => string | null = (
  notice: SloNotice,
  translator: Translator,
): string | null => {
  if (!notice.action) {
    return null;
  }

  return translator.translateText(notice.action.label) || notice.action.label;
};
