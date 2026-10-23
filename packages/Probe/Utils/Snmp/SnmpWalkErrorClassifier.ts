import {
  SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH,
  SnmpWalkAuthenticationReason,
  SnmpWalkFailure,
  SnmpWalkFailureKind,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import ProbeNetworkFailureUtil, {
  ProbeNetworkOperation,
} from "Common/Utils/ProbeNetworkFailureUtil";

/*
 * Why an SNMP walk stopped, in the terms the dashboard explains (issue
 * #5184): the agent refused the credentials, nothing answered, the probe
 * could not send at all, or the agent answered with an error.
 *
 * Read from what net-snmp raises:
 *
 *   - RequestTimedOutError: no answer in time. For SNMP v1 and v2c this is
 *     also a wrong community string - an agent drops a request whose
 *     community it does not know, without answering.
 *   - ResponseInvalidError, code EAuthFailure (5) or ECouldNotDecrypt (4):
 *     an SNMPv3 agent's Report naming a usmStats counter (RFC 3414), or a
 *     reply whose digest or encryption does not match ours.
 *   - RequestFailedError: the agent answered with an error status; noAccess
 *     and authorizationError are its access control refusing the request.
 *   - A Node error with a network code (ENOTFOUND, EHOSTUNREACH ...): the
 *     probe could not send. Probe-side causes get the shared wording
 *     ProbeNetworkFailureUtil gives every check, so a probe with no IPv6 is
 *     not mistaken for a device that is down.
 */

// ResponseInvalidCode values (net-snmp).
const RESPONSE_INVALID_COULD_NOT_DECRYPT: number = 4;
const RESPONSE_INVALID_AUTH_FAILURE: number = 5;

// ErrorStatus values (net-snmp, RFC 3416).
const ERROR_STATUS_NO_ACCESS: number = 6;
const ERROR_STATUS_AUTHORIZATION_ERROR: number = 16;

const UNREACHABLE_ERROR_CODES: Array<string> = [
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_NONAME",
  "EAI_FAIL",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "ENETUNREACH",
  "ENETDOWN",
  "ECONNREFUSED",
  "EADDRNOTAVAIL",
  "EAFNOSUPPORT",
  "EACCES",
  "EPERM",
];

/*
 * The usmStats texts net-snmp puts in its error message, and the ones its
 * own checks of a reply use, mapped to what they mean. Matched lower-cased,
 * most specific first.
 */
const AUTHENTICATION_REASONS: Array<{
  marker: string;
  reason: SnmpWalkAuthenticationReason;
}> = [
  {
    marker: "unknown user name",
    reason: SnmpWalkAuthenticationReason.UnknownUser,
  },
  {
    marker: "local user not found",
    reason: SnmpWalkAuthenticationReason.UnknownUser,
  },
  { marker: "wrong digest", reason: SnmpWalkAuthenticationReason.WrongDigest },
  {
    marker: "authentication digest",
    reason: SnmpWalkAuthenticationReason.WrongDigest,
  },
  {
    marker: "unsupported security level",
    reason: SnmpWalkAuthenticationReason.UnsupportedSecurityLevel,
  },
  {
    marker: "decryption error",
    reason: SnmpWalkAuthenticationReason.Decryption,
  },
  { marker: "decrypt", reason: SnmpWalkAuthenticationReason.Decryption },
  {
    marker: "not in time window",
    reason: SnmpWalkAuthenticationReason.NotInTimeWindow,
  },
  {
    marker: "unknown engine id",
    reason: SnmpWalkAuthenticationReason.UnknownEngineId,
  },
];

function messageOf(error: unknown): string {
  const message: string =
    error instanceof Error
      ? error.message || error.name
      : typeof error === "string"
        ? error
        : String(error);

  return message.substring(0, SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH);
}

function numberField(error: unknown, field: string): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const value: unknown = (error as Record<string, unknown>)[field];
  return typeof value === "number" ? value : undefined;
}

function stringField(error: unknown, field: string): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const value: unknown = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

export default class SnmpWalkErrorClassifier {
  /*
   * Session construction refused the device's saved credentials before a
   * request was sent: SNMPv3 with no user name, or a protocol the probe
   * does not recognise.
   */
  public static configuration(error: unknown): SnmpWalkFailure {
    return {
      kind: SnmpWalkFailureKind.Configuration,
      message: messageOf(error),
    };
  }

  public static classify(error: unknown, hostname: string): SnmpWalkFailure {
    const message: string = messageOf(error);
    const name: string | undefined = stringField(error, "name");
    const code: string | undefined = stringField(error, "code");

    const probeSideCause: string | null = ProbeNetworkFailureUtil.describeError(
      {
        host: hostname,
        error: error,
        operation: ProbeNetworkOperation.PingOrTraceroute,
      },
    );

    if (probeSideCause) {
      return {
        kind: SnmpWalkFailureKind.Unreachable,
        message: probeSideCause.substring(
          0,
          SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH,
        ),
      };
    }

    if (code && UNREACHABLE_ERROR_CODES.includes(code)) {
      return { kind: SnmpWalkFailureKind.Unreachable, message: message };
    }

    if (name === "RequestTimedOutError") {
      return { kind: SnmpWalkFailureKind.Timeout, message: message };
    }

    if (name === "ResponseInvalidError") {
      const responseCode: number | undefined = numberField(error, "code");

      if (
        responseCode === RESPONSE_INVALID_AUTH_FAILURE ||
        responseCode === RESPONSE_INVALID_COULD_NOT_DECRYPT
      ) {
        const lowerMessage: string = message.toLowerCase();

        const reason: SnmpWalkAuthenticationReason | undefined =
          AUTHENTICATION_REASONS.find(
            (entry: {
              marker: string;
              reason: SnmpWalkAuthenticationReason;
            }): boolean => {
              return lowerMessage.includes(entry.marker);
            },
          )?.reason ||
          (responseCode === RESPONSE_INVALID_COULD_NOT_DECRYPT
            ? SnmpWalkAuthenticationReason.Decryption
            : undefined);

        const failure: SnmpWalkFailure = {
          kind: SnmpWalkFailureKind.Authentication,
          message: message,
        };

        if (reason) {
          failure.authenticationReason = reason;
        }

        return failure;
      }

      return { kind: SnmpWalkFailureKind.AgentError, message: message };
    }

    if (name === "RequestFailedError") {
      const status: number | undefined = numberField(error, "status");

      if (
        status === ERROR_STATUS_NO_ACCESS ||
        status === ERROR_STATUS_AUTHORIZATION_ERROR
      ) {
        return {
          kind: SnmpWalkFailureKind.Authentication,
          authenticationReason: SnmpWalkAuthenticationReason.AccessDenied,
          message: message,
        };
      }

      /*
       * net-snmp's own check of a v3 reply's user: the reply names a user
       * this session does not have.
       */
      if (message.toLowerCase().includes("local user not found")) {
        return {
          kind: SnmpWalkFailureKind.Authentication,
          authenticationReason: SnmpWalkAuthenticationReason.UnknownUser,
          message: message,
        };
      }

      return { kind: SnmpWalkFailureKind.AgentError, message: message };
    }

    if (name === "SnmpWalkOutOfOrderError") {
      return { kind: SnmpWalkFailureKind.AgentError, message: message };
    }

    if (message.toLowerCase().includes("timed out")) {
      return { kind: SnmpWalkFailureKind.Timeout, message: message };
    }

    return { kind: SnmpWalkFailureKind.Unknown, message: message };
  }
}
