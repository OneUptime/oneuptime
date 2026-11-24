import LogScrubPatternType from "../../Types/Log/LogScrubPatternType";
import {
  SCRUB_RULE_BUILT_IN_PATTERNS,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
  scrubRegExpFromRanges,
} from "../../Types/Telemetry/ScrubRule";
import { EMAIL_ADDRESS_DETECTORS } from "../DataSecurity/Detectors/ContactDetectors";
import { CARD_NUMBER_DETECTORS } from "../DataSecurity/Detectors/FinancialDetectors";
import {
  findDetectorRanges,
  findInEveryReading,
  mergeRanges,
  TextRange,
  TextReadings,
} from "../DataSecurity/TextReadings";
import { readOwnValue } from "../LookupTable";
import ScrubIpAddress from "./ScrubIpAddress";

/*
 * WHAT A BUILT-IN SCRUB PATTERN FINDS IN A VALUE, FOR EVERY PLACE A RULE
 * RUNS.
 *
 * The log and trace engines (and session replays, exceptions and AI calls
 * through them: Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule), the
 * lookup of what reads a value a rule would hide
 * (Utils/Telemetry/ScrubRuleFieldReads) and a metric pipeline rule's
 * Matches Pattern filter compile a built-in pattern here, so a rule means
 * the same thing wherever it runs.
 *
 * A rule covers every finding of its data type (Data Security's coverage,
 * DATA_TYPE_OF_SCRUB_PATTERN_TYPE), so where the detectors find more than a
 * pattern does, the pattern hides what they find too, through the one
 * function every rule built on the detectors finds with
 * (DataSecurity/TextReadings.findDetectorRanges):
 *
 *  - IP Address: what Data Security calls an IP address and nothing else
 *    (ScrubIpAddress, #10393): an address right after a key's colon too
 *    (#10936), and in a percent-encoded URL (#10467);
 *  - Email Address: its own pattern's matches, in the text as written and
 *    with its percent-escapes read - jane.doe%40acmecorp.io in a URL's
 *    query string (#10935) - and every address the email detectors find:
 *    one in any script, 张伟@acmecorp.io or почта@пример.рф (#10960);
 *  - Credit Card Number: its own pattern's matches, in the text as written
 *    and with every script's digits read by their values - a card in
 *    fullwidth, Arabic-Indic or Persian digits (#10960) - and every card
 *    the card detectors find, an American Express number's 15 digits
 *    among them.
 *
 * Each pattern's own matches are kept, so a rule hides everything it hid
 * before. What two readings or the pattern and a detector share is one
 * match, hidden whole, and placed on the characters the text writes it
 * with, escapes and all. SSN and Phone Number keep their patterns alone.
 *
 * In time in line with the text's length: each pattern and detector is
 * bounded, and each reading of a text is made once.
 */

// Every match of a built-in pattern in a text, as String.prototype.replace finds them.
function patternRanges(pattern: RegExp, text: string): Array<TextRange> {
  return scrubRegExpFromBuiltIn(pattern).matchRanges(text);
}

const EMAIL_PATTERN: RegExp =
  SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.Email]!;
const CREDIT_CARD_PATTERN: RegExp =
  SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.CreditCard]!;

/*
 * Where an Email Address rule's matches are: its pattern's, as written and
 * with the text's percent-escapes read, and every address the email
 * detectors find, ranges two of them share made one.
 */
export function findEmailAddressRanges(text: string): Array<TextRange> {
  // No "@", and no escape one could be written as (%40): no address.
  if (!text || (text.indexOf("@") === -1 && text.indexOf("%") === -1)) {
    return [];
  }

  const readings: TextReadings = new TextReadings(text);

  return mergeRanges([
    ...findInEveryReading({
      text,
      needs: { readsPercentEncoded: true },
      findIn: (reading: string): Array<TextRange> => {
        return patternRanges(EMAIL_PATTERN, reading);
      },
      readings,
    }),
    ...findDetectorRanges(EMAIL_ADDRESS_DETECTORS, text, readings),
  ]);
}

/*
 * Where a Credit Card rule's matches are: its pattern's, as written and
 * with every script's digits read by their values, and every card the card
 * detectors find, ranges two of them share made one.
 */
export function findCardNumberRanges(text: string): Array<TextRange> {
  if (!text) {
    return [];
  }

  const readings: TextReadings = new TextReadings(text);

  return mergeRanges([
    ...findInEveryReading({
      text,
      needs: { readsDigitsOfEveryScript: true },
      findIn: (reading: string): Array<TextRange> => {
        return patternRanges(CREDIT_CARD_PATTERN, reading);
      },
      readings,
    }),
    ...findDetectorRanges(CARD_NUMBER_DETECTORS, text, readings),
  ]);
}

/*
 * A built-in pattern as a rule runs it - or null for a pattern type no
 * table lists (a custom pattern, a key-targeted rule): those are compiled
 * where their rule is.
 */
export function compileBuiltInScrubPattern(
  patternType: string,
): ScrubRegExp | null {
  switch (patternType) {
    case LogScrubPatternType.IPAddress:
      return ScrubIpAddress.toScrubRegExp();
    case LogScrubPatternType.Email:
      return scrubRegExpFromRanges({
        source: EMAIL_PATTERN.source,
        flags: EMAIL_PATTERN.flags,
        findRanges: findEmailAddressRanges,
      });
    case LogScrubPatternType.CreditCard:
      return scrubRegExpFromRanges({
        source: CREDIT_CARD_PATTERN.source,
        flags: CREDIT_CARD_PATTERN.flags,
        findRanges: findCardNumberRanges,
      });
    default: {
      /*
       * The saved rule's own word: a pattern type no table lists matches
       * nothing (a plain read answered "constructor" with a function).
       */
      const builtIn: RegExp | undefined = readOwnValue(
        SCRUB_RULE_BUILT_IN_PATTERNS,
        patternType,
      );

      // An instance of its own, so lastIndex is independent per use.
      return builtIn ? scrubRegExpFromBuiltIn(builtIn) : null;
    }
  }
}
