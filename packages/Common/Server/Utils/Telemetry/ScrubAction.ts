import { JSONObject } from "../../../Types/JSON";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import { SCRUB_HASH_TOKEN_PATTERN } from "../../../Types/Telemetry/ScrubHashTokenFormat";
import { digitsOnly } from "../../../Utils/DataSecurity/Detector";
import { foldDigits } from "../../../Utils/DataSecurity/DigitReadings";
import PercentDecodedText from "../../../Utils/DataSecurity/PercentDecodedText";
import ScrubIpAddress from "../../../Utils/Telemetry/ScrubIpAddress";
import { maskKeepingEnds } from "../../../Utils/Telemetry/ScrubMask";
import ScrubHashToken from "./ScrubHashToken";

/*
 * WHAT A SCRUB RULE LEAVES IN PLACE OF A MATCH - ONE ANSWER FOR EVERY
 * ENGINE.
 *
 * The log, trace and session replay scrubbers (App/FeatureSet/Telemetry/
 * Services/LogScrubRuleService.ts, TraceScrubRuleService.ts,
 * SessionReplayScrubService.ts) each kept a copy of this, the same three
 * actions written three times. They all call this now, so a rule means the
 * same thing wherever it runs, and a Hash rule hashes through the one
 * function that makes a project's token (ScrubHashToken, #10394):
 *
 *  - Redact: "[REDACTED]", and what an action no one knows does too;
 *  - Mask: a hint of it - an email's first letter and domain ending, a
 *    card's, phone's or Social Security number's last four digits, an IP
 *    address's shape and none of its digits (an IPv6 address has its own,
 *    #10393), anything else its first and last characters;
 *  - Hash: the project's token for it ("[HASHED:" and 16 hex characters),
 *    an IP address in one spelling for every way it is written, and an
 *    email address, a phone number or a custom pattern's match
 *    percent-encoded, or a card, a phone number, a Social Security number
 *    or a custom pattern's match in another script's digits, as the value
 *    it reads as (asItReads), so each has the token of the value written
 *    plainly; Mask reads them so too. An IP
 *    Address rule's token and address are also told to the recorder a
 *    batch of logs or traces Security Events reads passes in
 *    (applyAndRecord), for Security Events' address vault (#10395).
 *
 * A trace rule's action and pattern type are the log rule's words
 * (TraceScrubAction, TraceScrubPatternType), so one comparison serves both.
 */

export const SCRUB_REDACTED_TEXT: string = "[REDACTED]";

/*
 * Told each IP address an IP Address Hash rule hides, and the token it
 * leaves there: what ingest keeps for Security Events' address vault
 * (#10395), for a batch of logs or traces Security Events reads
 * (Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultWriter.ts).
 * Nothing else is told - no other pattern's match, nothing Redact or Mask
 * leaves - so only an address a Hash rule hid can be named again, and only
 * by Security Events.
 */
export interface ScrubHashedAddressRecorder {
  recordHashedAddress(data: {
    token: string;
    // In the one spelling its token is made of (ScrubIpAddress.canonicalize).
    address: string;
  }): void;
}

/*
 * Told what a record's rules did to the places Security Events reads a user
 * from: what ingest keeps for Security Events' user vault (#10632), for a
 * batch of logs or traces Security Events reads whose rules hash
 * (Server/Utils/SecurityEvent/UserVault/SecurityUserVaultWriter.ts). The
 * engines hand over what those places held before the rules and what the
 * rules left; the recorder keeps a user only where a Hash rule's token is
 * worked out of the value again (ScrubHashToken), so nothing but what the
 * rule really hashed is ever kept, and only where Security Events reads a
 * user.
 */
export interface ScrubHashedUserRecorder {
  // A span's user field the rules changed (enduser.id, user.id, an AI call's user).
  recordScrubbedUserValue(data: { before: string; after: string }): void;
  /*
   * A log line the rules changed, for the users Security Events' log
   * parsers read in it: its body and top-level attributes before the rules,
   * and the row as they left it.
   */
  recordScrubbedLogLine(data: {
    bodyBefore: string;
    attributesBefore: JSONObject;
    logRow: JSONObject;
  }): void;
}

export default class ScrubAction {
  /*
   * A match as a rule of `projectId` leaves it (apply) - and, when the rule
   * is an IP Address rule that hashes, the token and the address told to
   * `recorder`. The record keeps the token whatever the recorder does: one
   * that throws is ignored, so keeping an address can never cost a record.
   */
  public static applyAndRecord(data: {
    match: string;
    action: string;
    patternType: string;
    projectId: ObjectID | string | null | undefined;
    recorder?: ScrubHashedAddressRecorder | null | undefined;
  }): string {
    const replaced: string = ScrubAction.apply(data);

    if (
      data.recorder &&
      data.action === LogScrubAction.Hash &&
      data.patternType === LogScrubPatternType.IPAddress &&
      SCRUB_HASH_TOKEN_PATTERN.test(replaced)
    ) {
      try {
        data.recorder.recordHashedAddress({
          token: replaced,
          address: ScrubIpAddress.canonicalize(data.match),
        });
      } catch {
        // The vault is worth having, never worth a record.
      }
    }

    return replaced;
  }

  /*
   * A match as a rule of `projectId` leaves it. A Hash rule whose project is
   * not known cannot make the project's token, and redacts instead: the
   * value is hidden either way, never stored.
   */
  public static apply(data: {
    match: string;
    action: string;
    patternType: string;
    projectId: ObjectID | string | null | undefined;
  }): string {
    switch (data.action) {
      case LogScrubAction.Redact:
        return SCRUB_REDACTED_TEXT;

      case LogScrubAction.Hash:
        return ScrubAction.hash(data);

      case LogScrubAction.Mask:
        return ScrubAction.mask(data.match, data.patternType);

      default:
        return SCRUB_REDACTED_TEXT;
    }
  }

  // The project's token for a match.
  public static hash(data: {
    match: string;
    patternType: string;
    projectId: ObjectID | string | null | undefined;
  }): string {
    if (!data.projectId || !data.projectId.toString().trim()) {
      return SCRUB_REDACTED_TEXT;
    }

    if (data.patternType === LogScrubPatternType.IPAddress) {
      return ScrubHashToken.ofIpAddress({
        projectId: data.projectId,
        address: data.match,
      });
    }

    return ScrubHashToken.ofValue({
      projectId: data.projectId,
      value: ScrubAction.asItReads(data.match, data.patternType),
    });
  }

  /*
   * A match as the value it reads as, for its token and its mask: an email
   * address written in a percent-encoded URL with its escapes read
   * (jane.doe%40acmecorp.io is jane.doe@acmecorp.io, #10935), a card in
   * another script's digits in ASCII ones (４１１１ １１１１ … is
   * 4111 1111 …, #10960), and a phone number both ways and a Social
   * Security number in ASCII digits (#11030) - so it makes the token the
   * value written plainly makes. Anything else, and a value written
   * plainly, as it is.
   */
  public static asItReads(match: string, patternType: string): string {
    switch (patternType) {
      case LogScrubPatternType.Email:
        return PercentDecodedText.readableOf(match);
      case LogScrubPatternType.CreditCard:
      case LogScrubPatternType.SSN:
        return foldDigits(match);
      /*
       * A Custom Regex rule finds its pattern with a value's escapes read
       * and in every script's digits too (ScrubRule's ReadingsScrubRegExp,
       * #11031, #11033): a token after %3D, an IBAN in Arabic-Indic digits
       * has the token of the one written plainly.
       */
      case LogScrubPatternType.PhoneNumber:
      case LogScrubPatternType.Custom:
        return foldDigits(PercentDecodedText.readableOf(match));
      default:
        return match;
    }
  }

  // What Mask leaves of a match of a pattern type.
  public static mask(value: string, patternType: string): string {
    switch (patternType) {
      case LogScrubPatternType.Email: {
        const address: string = ScrubAction.asItReads(value, patternType);
        const atIndex: number = address.indexOf("@");

        if (atIndex > 0) {
          const dotIndex: number = address.lastIndexOf(".");

          if (dotIndex > atIndex) {
            // The first character whole: one beyond U+FFFF is two code units.
            const first: string = String.fromCodePoint(address.codePointAt(0)!);

            return first + "***@***" + address.substring(dotIndex);
          }
        }

        return "***@***.***";
      }

      case LogScrubPatternType.CreditCard: {
        // The last 4 digits only, each read by its value whatever its script.
        const digits: string = digitsOnly(value);

        if (digits.length >= 4) {
          return "****-****-****-" + digits.substring(digits.length - 4);
        }

        return "****-****-****-****";
      }

      case LogScrubPatternType.SSN: {
        // The last 4 digits only, in ASCII whatever their script.
        const ssnDigits: string = digitsOnly(
          ScrubAction.asItReads(value, patternType),
        );

        if (ssnDigits.length >= 4) {
          return "***-**-" + ssnDigits.substring(ssnDigits.length - 4);
        }

        return "***-**-****";
      }

      case LogScrubPatternType.PhoneNumber: {
        /*
         * The last 4 digits only, as the number reads: its escapes read,
         * its digits in ASCII whatever their script.
         */
        const phoneDigits: string = digitsOnly(
          ScrubAction.asItReads(value, patternType),
        );

        if (phoneDigits.length >= 4) {
          return "***-***-" + phoneDigits.substring(phoneDigits.length - 4);
        }

        return "***-***-****";
      }

      case LogScrubPatternType.IPAddress:
        return ScrubIpAddress.mask(value);

      case LogScrubPatternType.Custom:
        // Its first and last characters as the value reads: escapes read, digits in ASCII.
        return maskKeepingEnds(ScrubAction.asItReads(value, patternType));

      default:
        // First and last characters kept, whole (Utils/Telemetry/ScrubMask).
        return maskKeepingEnds(value);
    }
  }
}
