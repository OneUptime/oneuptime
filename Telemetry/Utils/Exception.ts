import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Crypto from "Common/Utils/Crypto";

export interface ExceptionFingerprintInput {
  message?: string;
  stackTrace?: string;
  exceptionType?: string;
  projectId?: ObjectID;
  serviceId?: ObjectID;
}

export interface TelemetryExceptionPayload {
  fingerprint: string;
  projectId: ObjectID;
  serviceId: ObjectID;
  exceptionType?: string;
  stackTrace?: string;
  message?: string;
}

export default class ExceptionUtil {
  /**
   * Normalizes a string by replacing dynamic values with placeholders.
   * This ensures that exceptions with the same root cause but different
   * dynamic values (like IDs, timestamps, etc.) get the same fingerprint.
   *
   * @param text - The text to normalize (message or stack trace)
   * @returns The normalized text with dynamic values replaced
   */
  public static normalizeForFingerprint(text: string): string {
    if (!text) {
      return "";
    }

    let normalized: string = text;

    // Order matters! More specific patterns should come before generic ones.

    // 1. UUIDs (e.g., 550e8400-e29b-41d4-a716-446655440000)
    normalized = normalized.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<UUID>",
    );

    // 2. MongoDB ObjectIDs (24 hex characters)
    normalized = normalized.replace(/\b[0-9a-f]{24}\b/gi, "<OBJECT_ID>");

    /*
     * 3. Stripe-style IDs (e.g., sub_xxx, cus_xxx, pi_xxx, ch_xxx, etc.)
     * These have a prefix followed by underscore and alphanumeric characters
     */
    normalized = normalized.replace(
      /\b(sub|cus|pi|ch|pm|card|price|prod|inv|txn|evt|req|acct|payout|ba|btok|src|tok|seti|si|cs|link|file|dp|icr|ii|il|is|isci|mbur|or|po|qt|rcpt|re|refund|sku|tax|txi|tr|us|wh)_[A-Za-z0-9]{10,32}\b/g,
      "<STRIPE_ID>",
    );

    /*
     * 4. Generic API/Service IDs - alphanumeric strings that look like IDs
     * Matches patterns like: prefix_alphanumeric or just long alphanumeric strings
     * Common in many services (AWS, GCP, etc.)
     */
    normalized = normalized.replace(
      /\b[a-z]{2,10}_[A-Za-z0-9]{8,}\b/g,
      "<SERVICE_ID>",
    );

    // 5. JWT tokens (three base64 segments separated by dots)
    normalized = normalized.replace(
      /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/g,
      "<JWT>",
    );

    // 6. Base64 encoded strings (long sequences, likely tokens or encoded data)
    normalized = normalized.replace(
      /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
      "<BASE64>",
    );

    // 7. IP addresses (IPv4)
    normalized = normalized.replace(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
      "<IP>",
    );

    // 8. IP addresses (IPv6) - simplified pattern
    normalized = normalized.replace(
      /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
      "<IPV6>",
    );
    normalized = normalized.replace(/\b::1\b/g, "<IPV6>"); // localhost IPv6

    // 9. Email addresses
    normalized = normalized.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      "<EMAIL>",
    );

    /*
     * 10. URLs with dynamic paths/query params (normalize the dynamic parts)
     * Keep the domain but normalize path segments that look like IDs
     */
    normalized = normalized.replace(
      /\/[0-9a-f]{8,}(?=\/|$|\?|#|\s|'|")/gi,
      "/<ID>",
    );

    /*
     * 11. Timestamps in various formats
     * ISO 8601 timestamps
     */
    normalized = normalized.replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
      "<TIMESTAMP>",
    );
    // Unix timestamps (10 or 13 digits)
    normalized = normalized.replace(/\b1[0-9]{9,12}\b/g, "<TIMESTAMP>");

    // 12. Date formats (YYYY-MM-DD, MM/DD/YYYY, etc.)
    normalized = normalized.replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, "<DATE>");
    normalized = normalized.replace(/\b\d{2}[-/]\d{2}[-/]\d{4}\b/g, "<DATE>");

    // 13. Time formats (HH:MM:SS, HH:MM)
    normalized = normalized.replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g, "<TIME>");

    // 14. Memory addresses (0x followed by hex)
    normalized = normalized.replace(/\b0x[0-9a-fA-F]+\b/g, "<MEMORY_ADDR>");

    // 15. Session IDs (common patterns) - MUST come before hex ID pattern
    normalized = normalized.replace(
      /\bsession[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
      "session_id=<SESSION>",
    );

    // 16. Request IDs (common patterns) - MUST come before hex ID pattern
    normalized = normalized.replace(
      /\brequest[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
      "request_id=<REQUEST>",
    );

    // 17. Correlation IDs - MUST come before hex ID pattern
    normalized = normalized.replace(
      /\bcorrelation[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
      "correlation_id=<CORRELATION>",
    );

    // 18. Transaction IDs - MUST come before hex ID pattern
    normalized = normalized.replace(
      /\btransaction[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
      "transaction_id=<TRANSACTION>",
    );

    // 19. Hex strings that are likely IDs (8+ chars)
    normalized = normalized.replace(/\b[0-9a-f]{8,}\b/gi, "<HEX_ID>");

    /*
     * 20. Quoted strings containing IDs or dynamic values
     * Match strings in single or double quotes that look like IDs
     */
    normalized = normalized.replace(/'[A-Za-z0-9_-]{16,}'/g, "'<ID>'");
    normalized = normalized.replace(/"[A-Za-z0-9_-]{16,}"/g, '"<ID>"');

    // 21. Port numbers in URLs or connection strings
    normalized = normalized.replace(/:(\d{4,5})(?=\/|$|\s)/g, ":<PORT>");

    /*
     * 22. Line numbers in stack traces (keep for context, but normalize large numbers)
     * This normalizes specific line/column references that might vary
     */
    normalized = normalized.replace(/:\d+:\d+\)?$/gm, ":<LINE>:<COL>)");

    // 23. Process/Thread IDs
    normalized = normalized.replace(/\bPID[:\s]*\d+\b/gi, "PID:<PID>");
    normalized = normalized.replace(/\bTID[:\s]*\d+\b/gi, "TID:<TID>");

    // 24. Numeric IDs in common patterns (id=123, id: 123, etc.)
    normalized = normalized.replace(/\bid[=:\s]*['"]?\d+['"]?/gi, "id=<ID>");

    // 25. Large numbers that are likely IDs (more than 6 digits)
    normalized = normalized.replace(/\b\d{7,}\b/g, "<NUMBER>");

    return normalized;
  }

  public static getFingerprint(data: ExceptionFingerprintInput): string {
    const message: string = data.message || "";
    const stackTrace: string = data.stackTrace || "";
    const type: string = data.exceptionType || "";
    const projectId: string = data.projectId?.toString() || "";
    const serviceId: string = data.serviceId?.toString() || "";

    /*
     * Normalize message and stack trace to group similar exceptions together
     * This replaces dynamic values like IDs, timestamps, etc. with placeholders
     */
    const normalizedMessage: string =
      ExceptionUtil.normalizeForFingerprint(message);
    const normalizedStackTrace: string =
      ExceptionUtil.normalizeForFingerprint(stackTrace);

    const hash: string = Crypto.getSha256Hash(
      projectId + serviceId + normalizedMessage + normalizedStackTrace + type,
    );

    return hash;
  }

  public static async saveOrUpdateTelemetryException(
    exception: TelemetryExceptionPayload,
  ): Promise<void> {
    // Exception is saved to main database as well (not just analytics db), so users can assgin it, resolve it, etc.

    if (!exception.fingerprint) {
      throw new BadDataException(
        "Fingerprint is required to save exception status",
      );
    }

    if (!exception.projectId) {
      throw new BadDataException(
        "Project ID is required to save exception status",
      );
    }

    if (!exception.serviceId) {
      throw new BadDataException(
        "Service ID is required to save exception status",
      );
    }

    const fingerprint: string = exception.fingerprint;

    // check if the exception with the same fingerprint already exists in the database

    const existingExceptionStatus: TelemetryException | null =
      await TelemetryExceptionService.findOneBy({
        query: {
          fingerprint: fingerprint,
          projectId: exception.projectId,
          telemetryServiceId: exception.serviceId,
        },
        select: {
          _id: true,
          occuranceCount: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (existingExceptionStatus) {
      // then update last seen as and unmark as resolved/muted
      await TelemetryExceptionService.updateOneBy({
        query: {
          _id: existingExceptionStatus._id,
        },
        data: {
          lastSeenAt: OneUptimeDate.now(),
          markedAsResolvedByUserId: null,
          isResolved: false,
          markedAsResolvedAt: null, // unmark as resolved if it was marked as resolved
          occuranceCount: (existingExceptionStatus.occuranceCount || 0) + 1,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (!existingExceptionStatus) {
      // Create a new exception status if it doesn't exist
      const newExceptionStatus: TelemetryException = new TelemetryException();
      newExceptionStatus.fingerprint = exception.fingerprint;
      newExceptionStatus.projectId = exception.projectId;
      newExceptionStatus.telemetryServiceId = exception.serviceId;
      newExceptionStatus.lastSeenAt = OneUptimeDate.now();
      newExceptionStatus.firstSeenAt = OneUptimeDate.now();
      newExceptionStatus.occuranceCount = 1;

      if (exception.exceptionType) {
        newExceptionStatus.exceptionType = exception.exceptionType;
      }

      if (exception.message) {
        newExceptionStatus.message = exception.message;
      }

      if (exception.stackTrace) {
        newExceptionStatus.stackTrace = exception.stackTrace;
      }

      // Save the new exception status to the database
      await TelemetryExceptionService.create({
        data: newExceptionStatus,
        props: {
          isRoot: true,
        },
      });
    }
  }
}
