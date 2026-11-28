import LogScrubPatternType from "../../Types/Log/LogScrubPatternType";
import {
  FindRangesUnderKey,
  SCRUB_RULE_BUILT_IN_PATTERNS,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
  scrubRegExpFromRanges,
} from "../../Types/Telemetry/ScrubRule";
import { DataTypeDetector } from "../DataSecurity/Detector";
import {
  EMAIL_ADDRESS_DETECTORS,
  PHONE_NUMBER_DETECTORS,
} from "../DataSecurity/Detectors/ContactDetectors";
import { CARD_NUMBER_DETECTORS } from "../DataSecurity/Detectors/FinancialDetectors";
import { US_SSN_DETECTORS } from "../DataSecurity/Detectors/GovernmentIdDetectors";
import {
  getHintedDataTypeIds,
  MAX_FIELD_PATH_LENGTH,
} from "../DataSecurity/FieldNameHints";
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
import {
  placeRangesOnStrings,
  readStoredText,
  StoredText,
} from "./ScrubStoredText";

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
 *    query string (#10935) - and with its fullwidth letters read, an
 *    address typed in fullwidth, ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ (#11385), and
 *    every address the email detectors find: one in any script,
 *    张伟@acmecorp.io or почта@пример.рф (#10960);
 *  - Credit Card Number: its own pattern's matches, in the text as written,
 *    with every script's digits read by their values - a card in
 *    fullwidth, Arabic-Indic or Persian digits (#10960) - in a URL, its
 *    groups apart by %20 or by a "+" as a query string writes a space
 *    (card=4539+1488+0343+6467, #11199), and typed wholly in fullwidth,
 *    its groups apart by fullwidth hyphens or ideographic spaces
 *    (４１１１－１１１１－１１１１－１１１１, #11115) or by another dash
 *    (4111–1111–1111–1111, #11385), and every card the card detectors
 *    find, an American Express number's 15 digits among them;
 *  - Phone Number: its own pattern's matches - North American numbers -
 *    and every phone number the detectors find (#11025, #11030): an
 *    international one, +44 20 7946 0958 or +49 30 123456, in the groups
 *    people write it in, a North American one as people write it, and a
 *    UK mobile, each on its own; and a national number of 9 to 12 digits
 *    of no other shape beside a word that names it, "tel 02012345678"
 *    (#11114); each in the text as written, with its percent-escapes read
 *    (/callback?phone=%2B44%2020%207946%200958), as a query string writes
 *    it (phone=%2B44+20+7946+0958, #11199), with every script's digits
 *    read, and typed wholly in fullwidth, its plus sign, hyphens,
 *    parentheses and ideographic spaces too (＋８１ ３－１２３４－５６７８,
 *    #11115), its groups apart by another dash and the words beside it
 *    typed in fullwidth (ＴＥＬ ＋８１ ３ー１２３４ー５６７８, #11385). What
 *    only looks like one is left: an order number, a timestamp or a time
 *    zone's offset, a version, a decimal or a coordinate (ContactDetectors,
 *    isWrittenAsPhoneNumber), and a national number no word names, "order
 *    02012345678";
 *  - SSN: its own pattern's matches, 123-45-6789, and every Social
 *    Security number the detectors find - in its groups set apart by dots
 *    or spaces too, by the SSA's rules, on its own, and as nine digits in a
 *    row beside a word that says SSN, "SSN 536221234" (#11114) - each in
 *    the text as written, with every script's digits read (#11030), in a
 *    URL, ssn=123+45+6789 (#11199), and typed wholly in fullwidth,
 *    ５３６－２２－８７３１ (#11115), or with another dash between its groups,
 *    536–22–8731 (#11385). Nine digits no word names, "ref 536221234",
 *    are left.
 *
 * Each pattern's own matches are kept, so a rule hides everything it hid
 * before. What two readings or the pattern and a detector share is one
 * match, hidden whole, and placed on the characters the text writes it
 * with, escapes and "+"s and fullwidth forms and all. A value the
 * detectors call a phone number or a Social Security number only beside a
 * word that names it is hidden where one of those words is near it in the
 * value the rule reads, as the scanner judges it
 * (TextReadings.findDetectorRanges): a log body's "phone=0201234567", an
 * attribute's "ssn: 536221234" - or, in a value an engine hands with the
 * key it is held under, where the key's name names it, as the scanner
 * counts a field's name: 02012345678 under `user.phone`, 536221234 under
 * `customer.ssn`, and inside a list or a map as Data Security reads its
 * JSON text (readsUnderKey, #11383).
 *
 * In time in line with the text's length: each pattern and detector is
 * bounded, each reading of a text is made once, and a detector that needs
 * its words looks for them only around its candidates.
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

// The fullwidth commercial at, which an address typed in fullwidth is written with (#11385).
const FULLWIDTH_AT_SIGN: string = "\uFF20";

/*
 * Every reading an email address is read in: as written, with its
 * percent-escapes read, and with its fullwidth letters read (#11385), as
 * the email detectors read one.
 */
const EVERY_READING_OF_AN_ADDRESS: ReadingNeeds = {
  readsPercentEncoded: true,
  readsFullwidthLetters: true,
};

/*
 * Where an Email Address rule's matches are: its pattern's, as written,
 * with the text's percent-escapes read and with its fullwidth letters read
 * (ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ, #11385), and every address the email
 * detectors find, ranges two of them share made one.
 */
export function findEmailAddressRanges(text: string): Array<TextRange> {
  // No "@", no escape one could be written as (%40) and no fullwidth one: no address.
  if (
    !text ||
    (text.indexOf("@") === -1 &&
      text.indexOf("%") === -1 &&
      text.indexOf(FULLWIDTH_AT_SIGN) === -1)
  ) {
    return [];
  }

  const readings: TextReadings = new TextReadings(text);

  return mergeRanges([
    ...findInEveryReading({
      text,
      needs: EVERY_READING_OF_AN_ADDRESS,
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
 * read, as a URL's query string reads it (a "+" for a space, #11199), with
 * every script's digits read by their values, with its fullwidth signs and
 * separators read as ASCII (#11115) and the other dashes between its
 * digits as hyphens, and with the fullwidth ASCII block read as ASCII
 * (#11385) - as the card, phone and Social Security number detectors read
 * one (withEveryReading).
 */
const EVERY_READING_OF_A_NUMBER: ReadingNeeds = {
  readsPercentEncoded: true,
  readsDigitsOfEveryScript: true,
  readsPlusAsSpace: true,
  readsFullwidthForms: true,
  readsFullwidthLetters: true,
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
 * query string writes it, with every script's digits read by their values
 * and its fullwidth forms read - and every phone number the detectors
 * find, a national one beside a word that names it, ranges two of them
 * share made one. `hintedDataTypeIds`: the types the name of the field the
 * text is the value of hints at, for a text under a key (#11383): under
 * `user.phone` a national number needs no word, and a whole value of a
 * phone's shape is one (TextReadings.findDetectorRanges).
 */
export function findPhoneNumberRanges(
  text: string,
  hintedDataTypeIds?: ReadonlySet<string> | undefined,
): Array<TextRange> {
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
    ...findDetectorRanges(PHONE_NUMBER_DETECTORS, text, readings, {
      hintedDataTypeIds,
    }),
  ]);
}

/*
 * Where an SSN rule's matches are: its pattern's, in every reading of a
 * number - as written, in a URL, in every script's digits, in fullwidth -
 * and every Social Security number the detectors find, nine digits in a
 * row beside a word that says SSN, ranges two of them share made one.
 * `hintedDataTypeIds`: as findPhoneNumberRanges' - under `customer.ssn`
 * nine digits in a row need no word (#11383).
 */
export function findSsnRanges(
  text: string,
  hintedDataTypeIds?: ReadonlySet<string> | undefined,
): Array<TextRange> {
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
    ...findDetectorRanges(US_SSN_DETECTORS, text, readings, {
      hintedDataTypeIds,
    }),
  ]);
}

// The most keys whose hints are remembered: a project's attributes are a few hundred.
const MAX_REMEMBERED_KEYS: number = 4_096;

// What a key's name hints at, by its first characters, which are all a name is read by.
const hintsOfKeys: Map<string, ReadonlySet<string>> = new Map<
  string,
  ReadonlySet<string>
>();

/*
 * The data types a key's name hints at, as Data Security reads a field's
 * name (FieldNameHints.getHintedDataTypeIds): the same few keys are read
 * on every record, so each is read once.
 */
export function getHintsOfKey(key: string): ReadonlySet<string> {
  const read: string = key.slice(0, MAX_FIELD_PATH_LENGTH);
  let hints: ReadonlySet<string> | undefined = hintsOfKeys.get(read);

  if (hints === undefined) {
    if (hintsOfKeys.size >= MAX_REMEMBERED_KEYS) {
      hintsOfKeys.clear();
    }

    hints = getHintedDataTypeIds(read);
    hintsOfKeys.set(read, hints);
  }

  return hints;
}

/*
 * A PHONE NUMBER OR SSN RULE READS A VALUE UNDER ITS KEY AS DATA SECURITY
 * READS IT (#11383).
 *
 * Data Security finds a national number of 9 to 12 digits, or an SSN as
 * nine digits in a row, beside a word that names it - and in a field whose
 * name names it: `user.phone` holding 02012345678, `customer.ssn` holding
 * 536221234 (TextScanner's hintedDataTypeIds), and a whole value of a
 * phone's shape there, "020 1234 5678" (FieldClassifier). A rule handed
 * the value alone kept those values, while Data Security's coverage said
 * the rule hid them. So an engine hands a rule the key a value is held
 * under (ScrubRegExp.underKey), and the rule reads the value as Data
 * Security reads it:
 *
 *  - a text under a key whose name hints the type is read with the name
 *    for the word every candidate needs, and whole by the type's shape
 *    (TextReadings.findDetectorRanges) - and so is a number sent under
 *    such a key, 536221234 under `customer.ssn`, which the table stores and
 *    Data Security reads as its text; under any other key a number stays
 *    the number it is, as a timestamp or an id must;
 *  - a list or a map is read as the JSON text the table stores it as
 *    (ScrubStoredText), with its key's name for that word when it hints the
 *    type, as Data Security reads it there: a map's key is a word right
 *    beside its value, and a word another of its texts writes is near it,
 *    [{"system":"phone","value":"02012345678"}]. What the detectors that
 *    need words find there is hidden in the texts that hold it, and each
 *    text is read as itself as well, as before.
 *
 * A key that hints nothing, over a text, changes nothing: the rule reads
 * the value alone, as it always has.
 */
function readsUnderKey(data: {
  dataTypeId: string;
  detectors: ReadonlyArray<DataTypeDetector>;
  findRanges: (
    text: string,
    hintedDataTypeIds?: ReadonlySet<string> | undefined,
  ) => Array<TextRange>;
}): FindRangesUnderKey {
  // The detectors whose finds depend on the words around a value.
  const wordDetectors: ReadonlyArray<DataTypeDetector> = data.detectors.filter(
    (detector: DataTypeDetector): boolean => {
      return Boolean(detector.requiresContext);
    },
  );

  return (
    key: string,
    value: unknown,
  ): ((text: string) => Array<TextRange>) | null => {
    const hints: ReadonlySet<string> = getHintsOfKey(key);
    const hinted: ReadonlySet<string> | undefined = hints.has(data.dataTypeId)
      ? hints
      : undefined;

    // A text, or a number, which the table stores and Data Security reads as its text.
    if (typeof value === "string" || typeof value === "number") {
      return hinted
        ? (text: string): Array<TextRange> => {
            return data.findRanges(text, hinted);
          }
        : null;
    }

    const stored: StoredText | null = readStoredText(value);

    if (!stored) {
      return null;
    }

    const found: Array<TextRange> = findDetectorRanges(
      wordDetectors,
      stored.text,
      undefined,
      { hintedDataTypeIds: hinted },
    );
    const placed: Map<string, Array<TextRange>> = found.length > 0
      ? placeRangesOnStrings(stored, found)
      : new Map();

    if (placed.size === 0) {
      return null;
    }

    return (text: string): Array<TextRange> => {
      const own: Array<TextRange> = data.findRanges(text);
      const inStoredText: Array<TextRange> | undefined = placed.get(text);

      return inStoredText ? mergeRanges([...own, ...inStoredText]) : own;
    };
  };
}

const PHONE_NUMBER_UNDER_KEY: FindRangesUnderKey = readsUnderKey({
  dataTypeId: "phone-number",
  detectors: PHONE_NUMBER_DETECTORS,
  findRanges: findPhoneNumberRanges,
});

const SSN_UNDER_KEY: FindRangesUnderKey = readsUnderKey({
  dataTypeId: "us-ssn",
  detectors: US_SSN_DETECTORS,
  findRanges: findSsnRanges,
});

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
        findRanges: (text: string): Array<TextRange> => {
          return findPhoneNumberRanges(text);
        },
        findRangesUnderKey: PHONE_NUMBER_UNDER_KEY,
      });
    case LogScrubPatternType.SSN:
      return scrubRegExpFromRanges({
        source: SSN_PATTERN.source,
        flags: SSN_PATTERN.flags,
        findRanges: (text: string): Array<TextRange> => {
          return findSsnRanges(text);
        },
        findRangesUnderKey: SSN_UNDER_KEY,
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
