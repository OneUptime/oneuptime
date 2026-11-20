import { JSONObject, JSONValue } from "../JSON";

/*
 * WHERE A STEP OF A CASE'S RESPONSE PLAN POINTS, AS A DESCRIPTOR (#10340):
 * the traces of its requests, the security events about an address, a user
 * or a host in the product that holds it. The plan and its checks' evidence
 * say what to open; each reader turns it into its own address - the
 * Dashboard into a route of its own (SecurityCaseResponsePlan.ts there), the
 * mobile app and OneUptime AI into theirs - so one plan is built the same on
 * the server and in the browser, with no app's routes in it.
 *
 * Kept in a check's evidence (SecurityCaseStepCheck.evidence), so read back
 * with readResponseLink: a stored link is data, and only what fits a kind is
 * kept.
 */

export enum ResponseLinkKind {
  // The Traces explorer on these traces.
  OpenTraces = "OpenTraces",
  // The Security Events explorer on the events that name a value.
  OpenEvents = "OpenEvents",
  // A page of the product that holds the evidence: a user in Okta, a host in CrowdStrike.
  OpenProvider = "OpenProvider",
}

// The most traces a link carries.
export const RESPONSE_LINK_MAX_TRACES: number = 20;

// The longest value or address a stored link keeps.
const MAX_TEXT_LENGTH: number = 2048;

// An https address, with nothing after it but more of the address.
const HTTPS_ADDRESS: RegExp = /^https:\/\/[^\s]+$/i;

export interface ResponseTracesLink {
  kind: ResponseLinkKind.OpenTraces;
  traceIds: Array<string>;
  // The window to open them over, as ISO times: both or neither.
  startTime?: string | undefined;
  endTime?: string | undefined;
}

export interface ResponseEventsLink {
  kind: ResponseLinkKind.OpenEvents;
  // The value the events name, as an observable: an address, a user, a host.
  observable: string;
  startTime: string;
  endTime: string;
}

export interface ResponseProviderLink {
  kind: ResponseLinkKind.OpenProvider;
  // The product, as its name is written: "Okta", "CrowdStrike Falcon".
  provider: string;
  // An https address in that product.
  url: string;
}

export type ResponseLink =
  | ResponseTracesLink
  | ResponseEventsLink
  | ResponseProviderLink;

function readText(value: JSONValue | undefined): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_TEXT_LENGTH)
    : "";
}

function readTime(value: JSONValue | undefined): string {
  const text: string = readText(value);

  return text && !Number.isNaN(new Date(text).getTime()) ? text : "";
}

/*
 * A link as stored, read back: null for anything that is not one of the
 * kinds, or that misses what its kind needs. A provider's address is kept
 * only when it is https.
 */
export function readResponseLink(value: unknown): ResponseLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const link: JSONObject = value as JSONObject;

  switch (link["kind"]) {
    case ResponseLinkKind.OpenTraces: {
      const traceIds: Array<string> = Array.isArray(link["traceIds"])
        ? Array.from(
            new Set(
              (link["traceIds"] as Array<JSONValue>)
                .map((traceId: JSONValue): string => {
                  return readText(traceId);
                })
                .filter(Boolean),
            ),
          ).slice(0, RESPONSE_LINK_MAX_TRACES)
        : [];
      const startTime: string = readTime(link["startTime"]);
      const endTime: string = readTime(link["endTime"]);

      if (traceIds.length === 0) {
        return null;
      }

      return {
        kind: ResponseLinkKind.OpenTraces,
        traceIds,
        ...(startTime && endTime ? { startTime, endTime } : {}),
      };
    }

    case ResponseLinkKind.OpenEvents: {
      const observable: string = readText(link["observable"]);
      const startTime: string = readTime(link["startTime"]);
      const endTime: string = readTime(link["endTime"]);

      return observable && startTime && endTime
        ? { kind: ResponseLinkKind.OpenEvents, observable, startTime, endTime }
        : null;
    }

    case ResponseLinkKind.OpenProvider: {
      const provider: string = readText(link["provider"]);
      const url: string = readText(link["url"]);

      return provider && HTTPS_ADDRESS.test(url)
        ? { kind: ResponseLinkKind.OpenProvider, provider, url }
        : null;
    }

    default:
      return null;
  }
}
