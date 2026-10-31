import Hostname from "../../Types/API/Hostname";

/*
 * The host a request was sent to, read from its own Host header - the name
 * the browser connected to - for the decisions that turn on it: whether a
 * custom domain may serve its owner's code (StatusPageCustomizationAccess),
 * which form a form's own domain answers with (FormAPI), and which counter a
 * request on that domain spends (FormRateLimit).
 *
 * Never Express' req.hostname: with `trust proxy` on, Express takes it from
 * X-Forwarded-Host, which a caller writes and several of the ingress's
 * locations pass on. The ingress overwrites Host with the name the request
 * came to ($host), so the raw Host is the one to trust.
 *
 * Kept pure - no services, no database - so the rate limiter can read it.
 */

const INVALID_HOST_AUTHORITY_CHARACTER: RegExp = /[\s/?#]/;

/**
 * Parse an HTTP Host authority (name, optionally with a port) into the
 * host name alone: lower case, without the port, and without the trailing
 * dot of a fully-qualified spelling. Null for anything that is not one host:
 * empty, with userinfo, two hosts, a path, or an invalid name.
 */
export const normalizeRequestHost: (
  rawHost: string | undefined,
) => string | null = (rawHost: string | undefined): string | null => {
  const authority: string = rawHost?.trim() || "";

  if (
    !authority ||
    authority.includes("@") ||
    authority.includes(",") ||
    INVALID_HOST_AUTHORITY_CHARACTER.test(authority) ||
    !Hostname.isValid(authority)
  ) {
    return null;
  }

  try {
    let hostname: string = Hostname.fromAuthority(authority)
      .hostname.trim()
      .toLowerCase();

    // Treat the fully-qualified spelling of a DNS name as the same host.
    if (hostname.endsWith(".")) {
      hostname = hostname.slice(0, -1);
    }

    return hostname || null;
  } catch {
    return null;
  }
};

// The headers a request's host is read from, as Node keys them.
export interface RequestWithHostHeader {
  headers?: { [name: string]: string | Array<string> | undefined } | undefined;
}

/*
 * The host of this request (see above). A Host header sent twice is no one
 * host: null, as for any other doubt.
 */
export const getRequestHost: (req: RequestWithHostHeader) => string | null = (
  req: RequestWithHostHeader,
): string | null => {
  const host: string | Array<string> | undefined = req.headers?.["host"];

  if (typeof host !== "string") {
    return null;
  }

  return normalizeRequestHost(host);
};
