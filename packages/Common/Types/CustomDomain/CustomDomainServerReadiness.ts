import { JSONObject } from "../JSON";
import { fillTemplate, translationKey } from "../Translator";

/*
 * WHETHER THIS SERVER CAN SERVE A CUSTOM DOMAIN AT ALL.
 *
 * Three of the four reports about custom domains (#1521, #1692, #1774) were
 * self-hosted servers that could not serve one: the CNAME target was not
 * set, or not pointed at the server, or a proxy in front of it did not pass
 * the custom domain on. Each person found out only after changing their DNS
 * and waiting, from "CNAME is not verified". So before anybody adds a
 * record, a self-hosted server checks what it needs and says what is
 * missing and where it is set:
 *
 *   - TargetSet: the address CNAME records point to is set
 *     (STATUS_PAGE_CNAME_RECORD; statusPage.cnameRecord in Helm);
 *   - TargetResolves: that address resolves in DNS;
 *   - Port80: a request to it on port 80 reaches this OneUptime - where
 *     visitors and Let's Encrypt reach every custom domain;
 *   - Port443: it accepts connections on port 443, for HTTPS;
 *   - FreeCertificates: this server issues free certificates (a Let's
 *     Encrypt account key) - a warning, not a failure: without one, a
 *     custom domain's HTTPS is the operator's own proxy's.
 *
 * Checked from the server itself: what people outside its network see can
 * differ, and the sentences say so. OneUptime Cloud skips all of it.
 *
 * Shape and words in one React-free file, so the Dashboard draws it (the
 * templates are keys of its locales: a "keys" root of its extractor) and an
 * installation health check (#6826) can print it.
 */

export enum CustomDomainReadinessCheckId {
  TargetSet = "TargetSet",
  TargetResolves = "TargetResolves",
  Port80 = "Port80",
  Port443 = "Port443",
  FreeCertificates = "FreeCertificates",
}

export enum CustomDomainReadinessOutcome {
  Pass = "Pass",
  // Custom domains cannot work until it is fixed.
  Fail = "Fail",
  // They work, with something the operator should know.
  Warn = "Warn",
}

/*
 * Why a check failed, where it can fail in more than one way: port 80 with
 * nothing answering, or answering as something other than this OneUptime.
 */
export enum CustomDomainReadinessReason {
  NoAnswer = "NoAnswer",
  NotThisServer = "NotThisServer",
}

export interface CustomDomainReadinessCheck {
  id: CustomDomainReadinessCheckId;
  outcome: CustomDomainReadinessOutcome;
  reason?: CustomDomainReadinessReason | undefined;
  // What its sentence names: the target, a variable, addresses, a status.
  values: Record<string, string>;
}

export interface CustomDomainServerReadinessResult {
  // The address CNAME records point to; empty when it is not set.
  target: string;
  checks: Array<CustomDomainReadinessCheck>;
  checkedAt?: Date | undefined;
}

export const CustomDomainReadinessWords: {
  notReadyTitle: string;
  warningTitle: string;
  checkedFromServer: string;
  targetSet: string;
  targetNotSet: string;
  targetResolves: string;
  targetDoesNotResolve: string;
  port80Reaches: string;
  port80NotThisServer: string;
  port80NoAnswer: string;
  port443Answers: string;
  port443NoAnswer: string;
  freeCertificates: string;
  noFreeCertificates: string;
} = {
  notReadyTitle: translationKey(
    "This server is not ready for custom domains yet",
  ),
  warningTitle: translationKey("Before you add a custom domain"),
  checkedFromServer: translationKey(
    "We checked from this server. People outside your network must reach {{target}} on the same ports.",
  ),
  targetSet: translationKey(
    "Custom domains point to {{target}}, set in {{variable}}.",
  ),
  targetNotSet: translationKey(
    "Custom domains are off: {{variable}} is not set. Set it to a hostname that points to this server ({{helmValue}} in the Helm chart's values), then restart OneUptime.",
  ),
  targetResolves: translationKey("{{target}} resolves to {{addresses}}."),
  targetDoesNotResolve: translationKey(
    "{{target}} does not resolve in DNS. Add an A record for it that points to this server's public IP address.",
  ),
  port80Reaches: translationKey(
    "{{target}} reaches this OneUptime server on port 80.",
  ),
  port80NotThisServer: translationKey(
    "{{target}} answers on port 80, but not as this OneUptime server (HTTP {{status}}). A proxy or load balancer at that address must pass requests for every hostname on to OneUptime.",
  ),
  port80NoAnswer: translationKey(
    "{{target}} does not answer on port 80. Open port 80 to this server: visitors and Let's Encrypt reach custom domains there.",
  ),
  port443Answers: translationKey("{{target}} accepts connections on port 443."),
  port443NoAnswer: translationKey(
    "{{target}} does not accept connections on port 443. Open port 443 to this server, so visitors can open custom domains over HTTPS.",
  ),
  freeCertificates: translationKey(
    "This server issues free certificates from Let's Encrypt.",
  ),
  noFreeCertificates: translationKey(
    "This server issues no free certificates: LETS_ENCRYPT_ACCOUNT_KEY is not set (letsEncrypt.accountKey in the Helm chart). Serve HTTPS for custom domains at your own proxy, or upload a certificate for each domain.",
  ),
};

export const describeReadinessCheck: (check: CustomDomainReadinessCheck) => {
  template: string;
  values: Record<string, string>;
} = (
  check: CustomDomainReadinessCheck,
): { template: string; values: Record<string, string> } => {
  const isPass: boolean = check.outcome === CustomDomainReadinessOutcome.Pass;
  const words: typeof CustomDomainReadinessWords = CustomDomainReadinessWords;

  let template: string;

  switch (check.id) {
    case CustomDomainReadinessCheckId.TargetSet:
      template = isPass ? words.targetSet : words.targetNotSet;
      break;
    case CustomDomainReadinessCheckId.TargetResolves:
      template = isPass ? words.targetResolves : words.targetDoesNotResolve;
      break;
    case CustomDomainReadinessCheckId.Port80:
      template = isPass
        ? words.port80Reaches
        : check.reason === CustomDomainReadinessReason.NotThisServer
          ? words.port80NotThisServer
          : words.port80NoAnswer;
      break;
    case CustomDomainReadinessCheckId.Port443:
      template = isPass ? words.port443Answers : words.port443NoAnswer;
      break;
    case CustomDomainReadinessCheckId.FreeCertificates:
    default:
      template = isPass ? words.freeCertificates : words.noFreeCertificates;
      break;
  }

  return { template, values: check.values };
};

// The check in English: for logs and a health check's output.
export const describeReadinessCheckInEnglish: (
  check: CustomDomainReadinessCheck,
) => string = (check: CustomDomainReadinessCheck): string => {
  const described: { template: string; values: Record<string, string> } =
    describeReadinessCheck(check);

  return fillTemplate(described.template, described.values);
};

const IDS: Array<string> = Object.values(CustomDomainReadinessCheckId);
const OUTCOMES: Array<string> = Object.values(CustomDomainReadinessOutcome);
const REASONS: Array<string> = Object.values(CustomDomainReadinessReason);

export default class CustomDomainServerReadiness {
  // Ready unless a check failed: a warning does not stop a custom domain.
  public static isReady(result: CustomDomainServerReadinessResult): boolean {
    return !result.checks.some((check: CustomDomainReadinessCheck): boolean => {
      return check.outcome === CustomDomainReadinessOutcome.Fail;
    });
  }

  // Whether anything is worth showing: a failure or a warning.
  public static needsAttention(
    result: CustomDomainServerReadinessResult,
  ): boolean {
    return result.checks.some((check: CustomDomainReadinessCheck): boolean => {
      return check.outcome !== CustomDomainReadinessOutcome.Pass;
    });
  }

  public static toJSON(result: CustomDomainServerReadinessResult): JSONObject {
    const json: JSONObject = {
      target: result.target,
      checks: result.checks.map(
        (check: CustomDomainReadinessCheck): JSONObject => {
          const item: JSONObject = {
            id: check.id,
            outcome: check.outcome,
            values: { ...check.values },
          };

          if (check.reason) {
            item["reason"] = check.reason;
          }

          return item;
        },
      ),
    };

    if (result.checkedAt) {
      json["checkedAt"] = result.checkedAt.toISOString();
    }

    return json;
  }

  // Reads the answer, leaving out any check it does not know.
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): CustomDomainServerReadinessResult {
    const result: CustomDomainServerReadinessResult = {
      target: typeof json?.["target"] === "string" ? json["target"] : "",
      checks: [],
    };

    const checks: unknown = json?.["checks"];

    if (Array.isArray(checks)) {
      for (const entry of checks) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          continue;
        }

        const item: JSONObject = entry as JSONObject;
        const id: unknown = item["id"];
        const outcome: unknown = item["outcome"];

        if (
          typeof id !== "string" ||
          !IDS.includes(id) ||
          typeof outcome !== "string" ||
          !OUTCOMES.includes(outcome)
        ) {
          continue;
        }

        const values: Record<string, string> = {};
        const rawValues: unknown = item["values"];

        if (
          rawValues &&
          typeof rawValues === "object" &&
          !Array.isArray(rawValues)
        ) {
          for (const [key, value] of Object.entries(rawValues as JSONObject)) {
            if (typeof value === "string") {
              values[key] = value;
            }
          }
        }

        const check: CustomDomainReadinessCheck = {
          id: id as CustomDomainReadinessCheckId,
          outcome: outcome as CustomDomainReadinessOutcome,
          values: values,
        };

        const reason: unknown = item["reason"];

        if (typeof reason === "string" && REASONS.includes(reason)) {
          check.reason = reason as CustomDomainReadinessReason;
        }

        result.checks.push(check);
      }
    }

    const checkedAt: unknown = json?.["checkedAt"];

    if (typeof checkedAt === "string" && checkedAt) {
      const date: Date = new Date(checkedAt);

      if (!isNaN(date.getTime())) {
        result.checkedAt = date;
      }
    }

    return result;
  }
}
