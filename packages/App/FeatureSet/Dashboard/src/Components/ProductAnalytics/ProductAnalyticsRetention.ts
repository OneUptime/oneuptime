import {
  DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS,
  PRODUCT_ANALYTICS_RETENTION_MONTHS_OPTIONS,
  getProductAnalyticsRetentionMonths,
} from "Common/Types/Rum/ProductAnalytics";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  PluralTemplate,
  Translator,
} from "Common/Types/Translator";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How long product analytics keeps an application's numbers and events
 * (issue #6626), as Analytics Settings sets it and the pages say it: 3, 6,
 * 13 or 25 months, 13 by default. React-free, so the page, the reads' words
 * and the tests share one set.
 *
 * Without a translator the words read in English, word for word; a page
 * hands its reader's translator in.
 */
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE, {
  drawsOnPage: true,
});

// The card, folded under Analytics Settings' More settings, and its place.
export const PRODUCT_ANALYTICS_RETENTION_TITLE: string = translationKey(
  "Product Analytics Retention",
);

export const PRODUCT_ANALYTICS_RETENTION_PLACE: string =
  getPageAnchorNameForTitle(PRODUCT_ANALYTICS_RETENTION_TITLE);

export const PRODUCT_ANALYTICS_RETENTION_DESCRIPTION: string = translationKey(
  "How long product analytics keeps this application's numbers and events. Lowering it removes the older months within a day.",
);

export const PRODUCT_ANALYTICS_RETENTION_FIELD_DESCRIPTION: string =
  translationKey(
    "Calendar months, the current one included. Recordings keep their own retention.",
  );

export const PRODUCT_ANALYTICS_MORE_SETTINGS_TEST_ID: string =
  "product-analytics-more-settings";

export const PRODUCT_ANALYTICS_RETENTION_LINE_TEST_ID: string =
  "product-analytics-retention-line";

// A retention, as the card and the folded header say it: "13 months".
const RETENTION_MONTHS: PluralTemplate = {
  one: "{{count}} month",
  other: "{{count}} months",
};

/*
 * The choices, in the reader's language: "3 months", "13 months
 * (default)". Each label is a whole phrase for its count, so a language
 * says each its own way.
 */
export function getProductAnalyticsRetentionOptions(
  translator: Translator = ENGLISH,
): Array<DropdownOption> {
  return PRODUCT_ANALYTICS_RETENTION_MONTHS_OPTIONS.map(
    (months: number): DropdownOption => {
      return {
        label:
          months === DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS
            ? translator.translatePlural(
                {
                  one: "{{count}} month (default)",
                  other: "{{count}} months (default)",
                },
                months,
              )
            : translator.translatePlural(RETENTION_MONTHS, months),
        value: months,
      };
    },
  );
}

/* How long an application keeps its numbers: "13 months", the default when unset. */
export function formatProductAnalyticsRetention(
  months: number | null | undefined,
  translator: Translator = ENGLISH,
): string {
  return translator.translatePlural(
    RETENTION_MONTHS,
    getProductAnalyticsRetentionMonths(months),
  );
}

/*
 * The months a read says the application keeps, for the pages' words ("in
 * the last 13 months"): the default when an older server left it out.
 */
export function readProductAnalyticsRetentionMonths(
  read: { retentionMonths?: number | undefined } | null | undefined,
): number {
  return getProductAnalyticsRetentionMonths(read?.retentionMonths);
}
