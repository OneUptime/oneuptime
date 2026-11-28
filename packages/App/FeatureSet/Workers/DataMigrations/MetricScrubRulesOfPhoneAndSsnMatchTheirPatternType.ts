import MetricScrubRulesMatchTheirPatternType, {
  FrozenScrubItPattern,
} from "./MetricScrubRulesMatchTheirPatternType";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";

/*
 * THE METRIC RULES SCRUB IT MADE FOR A PHONE NUMBER OR A US SOCIAL
 * SECURITY NUMBER, MOVED TO THE PATTERN TYPE THAT HIDES WHAT DATA SECURITY
 * FINDS (#11112).
 *
 * Scrub It on a metric attribute made a Redact Attribute rule whose filter
 * was the data type's own pattern, frozen into the rule as a Matches Regex
 * filter on the attribute - for a phone number the shapes of its
 * detectors that need no word beside a value, for an SSN its groups. Such
 * a pattern validates nothing: it took +51.507217 and +1 2026-11-24 for
 * phone numbers and 666.22.8731 for an SSN. And it reads a value as
 * written: a number percent-encoded, typed into a form, in another
 * script's digits or wholly in fullwidth stayed in the label, as did a
 * national number or nine digits beside the word that names them, while
 * the finding said it was hidden.
 *
 * Scrub It now gives such a rule a Matches Pattern Type filter of Phone
 * Number or SSN (TelemetryScrubCoverage.METRIC_PATTERN_TYPE_OF_DATA_TYPE),
 * the very pattern a log or trace rule of the type runs: what the
 * detectors find, in every reading they read (#11030, #11114, #11115).
 * Each rule made before gets the same, as the rules of the three types
 * before them did (MetricScrubRulesMatchTheirPatternType, #10934, whose
 * code this runs with these patterns): its filter that is exactly a
 * frozen pattern Scrub It wrote for the type, on the attribute the rule
 * redacts, becomes that filter. Coverage compares a rule's filters with
 * Scrub It's exactly, so each rule moved covers its findings again.
 *
 * Scrub It wrote the phone pattern two ways: until #11030 its
 * international numbers' groups were set apart by spaces, hyphens, dots
 * and parentheses, and since then by a no-break space too. Both are moved.
 * Only Scrub It's rules: a Redact Attribute rule, a filter on the very
 * attribute it redacts, holding one of these patterns word for word -
 * patterns no person writes. A filter a person wrote, another type's
 * pattern, a Drop rule (Drop This Metric keeps its pattern) and every
 * other filter of the rule are left as they are. A rule moved hides, from
 * its next batch on, what it read encoded, in another script's digits or
 * in fullwidth, any ten digits as a Phone Number rule's own pattern does,
 * and a national number or nine digits beside their words; and it stops
 * redacting a decimal, a time zone's offset, a version, and groups the
 * Social Security Administration never issues - no one's personal data -
 * as a log or trace rule of the type keeps them.
 *
 * Postgres only. Safe to run twice, and two at once: a moved filter is no
 * longer a frozen pattern, and a rule saved again since it was read is not
 * written over.
 */
export const FROZEN_PHONE_AND_SSN_SCRUB_IT_PATTERNS: ReadonlyArray<FrozenScrubItPattern> =
  [
    // The phone pattern Scrub It wrote until #11030.
    {
      dataTypeId: "phone-number",
      pattern:
        "(?:(?<![A-Za-z0-9+])\\+[1-9][0-9 ().-]{6,22}[0-9](?![0-9]))|(?:(?<![A-Za-z0-9])(?:\\([2-9][0-9]{2}\\)[ ]?|[2-9][0-9]{2}[-.])[2-9][0-9]{2}[-.][0-9]{4}(?![0-9]))|(?:(?<![A-Za-z0-9+])07[0-9]{3}[ ]?[0-9]{3}[ ]?[0-9]{3}(?![0-9]))",
      patternType: LogScrubPatternType.PhoneNumber,
    },
    // And since: an international number's groups apart by a no-break space too.
    {
      dataTypeId: "phone-number",
      pattern:
        "(?:(?<![A-Za-z0-9+])\\+[1-9][0-9 \\u00A0().-]{6,22}[0-9](?![0-9]))|(?:(?<![A-Za-z0-9])(?:\\([2-9][0-9]{2}\\)[ ]?|[2-9][0-9]{2}[-.])[2-9][0-9]{2}[-.][0-9]{4}(?![0-9]))|(?:(?<![A-Za-z0-9+])07[0-9]{3}[ ]?[0-9]{3}[ ]?[0-9]{3}(?![0-9]))",
      patternType: LogScrubPatternType.PhoneNumber,
    },
    {
      dataTypeId: "us-ssn",
      pattern:
        "(?<![A-Za-z0-9]|[0-9][-. ])[0-9]{3}(?:-[0-9]{2}-|\\.[0-9]{2}\\.| [0-9]{2} )[0-9]{4}(?![A-Za-z0-9]|[-. ][0-9])",
      patternType: LogScrubPatternType.SSN,
    },
  ];

export default class MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType extends MetricScrubRulesMatchTheirPatternType {
  public constructor() {
    super(
      "MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType",
      FROZEN_PHONE_AND_SSN_SCRUB_IT_PATTERNS,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: moved back, a rule would again take a decimal for a
     * phone number, and leave what it read encoded, in another script's
     * digits, in fullwidth or beside the words that name it.
     */
    return;
  }
}
