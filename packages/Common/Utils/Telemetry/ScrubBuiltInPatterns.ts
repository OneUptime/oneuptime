import LogScrubPatternType from "../../Types/Log/LogScrubPatternType";
import {
  SCRUB_RULE_BUILT_IN_PATTERNS,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
  scrubRegExpFromRanges,
} from "../../Types/Telemetry/ScrubRule";
import {
  EMAIL_ADDRESS_DETECTORS,
  PHONE_NUMBER_DETECTORS,
} from "../DataSecurity/Detectors/ContactDetectors";
import { CARD_NUMBER_DETECTORS } from "../DataSecurity/Detectors/FinancialDetectors";
import { US_SSN_DETECTORS } from "../DataSecurity/Detectors/GovernmentIdDetectors";
import {
  findDetectorRanges,
  findInEveryReading,
  mergeRanges,
  ReadingNeeds,
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
 *  - Credit Card Number: its own pattern's matches, in the text as written,
 *    with every script's digits read by their values - a card in
 *    fullwidth, Arabic-Indic or Persian digits (#10960) - and in a URL,
 *    its groups apart by %20 or by a "+" as a query string writes a space
 *    (card=4539+1488+0343+6467, #11199), and every card the card detectors
 *    find, an American Express number's 15 digits among them;
 *  - Phone Number: its own pattern's matches - North American numbers -
 *    and every phone number the detectors find on its own (#11025,
 *    #11030): an international one, +44 20 7946 0958 or +49 30 123456, in
 *    the groups people write it in, a North American one as people write
 *    it, and a UK mobile; each in the text as written, with its
 *    percent-escapes read (/callback?phone=%2B44%2020%207946%200958), as a
 *    query string writes it (phone=%2B44+20+7946+0958, #11199) and with
 *    every script's digits read. What only looks like one is left: an
 *    order number, a timestamp or a time zone's offset, a version, a
 *    decimal or a coordinate (ContactDetectors, isWrittenAsPhoneNumber);
 *  - SSN: its own pattern's matches, 123-45-6789, and every Social
 *    Security number the detectors find on its own - in its groups set
 *    apart by dots or spaces too, by the SSA's rules - each in the text as
 *    written, with every script's digits read (#11030) and in a URL,
 *    ssn=123+45+6789 (#11199).
 *
 * Each pattern's own matches are kept, so a rule hides everything it hid
 * before. What two readings or the pattern and a detector share is one
 * match, hidden whole, and placed on the characters the text writes it
 * with, escapes and "+"s and all. A value the detectors call a phone number or a
 * Social Security number only beside a word that names it - a national
 * number with no other shape, nine digits in a row - is hidden only where
 * the rule's own pattern finds it: a rule reads one value, not the words
 * around a finding.
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
const PHONE_NUMBER_PATTERN: RegExp =
  SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.PhoneNumber]!;
const SSN_PATTERN: RegExp =
  SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.SSN]!;

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
 * Every reading a number is read in: as written, with its percent-escapes
 * read, as a URL's query string reads it (a "+" for a space, #11199), and
 * with every script's digits read by their values - as the card, phone
 * and Social Security number detectors read one (withEveryReading).
 */
const EVERY_READING_OF_A_NUMBER: ReadingNeeds = {
  readsPercentEncoded: true,
  readsDigitsOfEveryScript: true,
  readsPlusAsSpace: true,
};

/*
 * Where a Credit Card rule's matches are: its pattern's, in every reading
 * of a number - as written, in a URL with %20 or "+" between its groups,
 * in every script's digits - and every card the card detectors find,
 * ranges two of them share made one.
 */
export function findCardNumberRanges(text: string): Array<TextRange> {
  if (!text) {
    return [];
  }

  const readings: TextReadings = new TextReadings(text);

  return mergeRanges([
    ...findInEveryReading({
      text,
      needs: EVERY_READING_OF_A_NUMBER,
      findIn: (reading: string): Array<TextRange> => {
        return patternRanges(CREDIT_CARD_PATTERN, reading);
      },
      readings,
    }),
    ...findDetectorRanges(CARD_NUMBER_DETECTORS, text, readings),
  ]);
}

/*
 * Where a Phone Number rule's matches are: its pattern's, in every reading
 * of a number - as written, with the text's percent-escapes read, as a
 * query string writes it, and with every script's digits read by their
 * values - and every phone number the detectors find on its own, ranges
 * two of them share made one.
 */
export function findPhoneNumberRanges(text: string): Array<TextRange> {
  if (!text) {
    return [];
  }

  const readings: TextReadings = new TextReadings(text);

  return mergeRanges([
    ...findInEveryReading({
      text,
      needs: EVERY_READING_OF_A_NUMBER,
      findIn: (reading: string): Array<TextRange> => {
        return patternRanges(PHONE_NUMBER_PATTERN, reading);
      },
      readings,
    }),
    ...findDetectorRanges(PHONE_NUMBER_DETECTORS, text, readings),
  ]);
}

/*
 * Where an SSN rule's matches are: its pattern's, in every reading of a
 * number - as written, in a URL, in every script's digits - and every
 * Social Security number the detectors find on its own, ranges two of
 * them share made one.
 */
export function findSsnRanges(text: string): Array<TextRange> {
  if (!text) {
    return [];
  }

  const readings: TextReadings = new TextReadings(text);

  return mergeRanges([
    ...findInEveryReading({
      text,
      needs: EVERY_READING_OF_A_NUMBER,
      findIn: (reading: string): Array<TextRange> => {
        return patternRanges(SSN_PATTERN, reading);
      },
      readings,
    }),
    ...findDetectorRanges(US_SSN_DETECTORS, text, readings),
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
    case LogScrubPatternType.PhoneNumber:
      return scrubRegExpFromRanges({
        source: PHONE_NUMBER_PATTERN.source,
        flags: PHONE_NUMBER_PATTERN.flags,
        findRanges: findPhoneNumberRanges,
      });
    case LogScrubPatternType.SSN:
      return scrubRegExpFromRanges({
        source: SSN_PATTERN.source,
        flags: SSN_PATTERN.flags,
        findRanges: findSsnRanges,
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
