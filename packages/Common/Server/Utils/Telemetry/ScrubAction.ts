import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
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
 *    an IP address in one spelling for every way it is written.
 *
 * A trace rule's action and pattern type are the log rule's words
 * (TraceScrubAction, TraceScrubPatternType), so one comparison serves both.
 */

export const SCRUB_REDACTED_TEXT: string = "[REDACTED]";

export default class ScrubAction {
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
      value: data.match,
    });
  }

  // What Mask leaves of a match of a pattern type.
  public static mask(value: string, patternType: string): string {
    switch (patternType) {
      case LogScrubPatternType.Email: {
        const atIndex: number = value.indexOf("@");

        if (atIndex > 0) {
          const dotIndex: number = value.lastIndexOf(".");

          if (dotIndex > atIndex) {
            return value[0] + "***@***" + value.substring(dotIndex);
          }
        }

        return "***@***.***";
      }

      case LogScrubPatternType.CreditCard: {
        // The last 4 digits only.
        const digits: string = value.replace(/[-\s]/g, "");

        if (digits.length >= 4) {
          return "****-****-****-" + digits.substring(digits.length - 4);
        }

        return "****-****-****-****";
      }

      case LogScrubPatternType.SSN:
        return "***-**-" + value.substring(value.length - 4);

      case LogScrubPatternType.PhoneNumber: {
        // The last 4 digits only.
        const phoneDigits: string = value.replace(/[^0-9]/g, "");

        if (phoneDigits.length >= 4) {
          return "***-***-" + phoneDigits.substring(phoneDigits.length - 4);
        }

        return "***-***-****";
      }

      case LogScrubPatternType.IPAddress:
        return ScrubIpAddress.mask(value);

      default:
        // First and last characters kept, whole (Utils/Telemetry/ScrubMask).
        return maskKeepingEnds(value);
    }
  }
}
