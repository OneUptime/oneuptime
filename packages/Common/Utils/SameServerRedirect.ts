/*
 * A request that carries one of OneUptime's keys - the cluster key its own
 * services present to each other, a probe's key, a Runner's key - follows
 * a redirect only while it stays on the server it was sent to.
 *
 * An HTTP client follows a redirect wherever it points, and sends the
 * redirected request with the original's headers (all but Authorization,
 * Cookie and Proxy-Authorization) and, for a 307 or 308, with its body
 * too. The key would go to whatever server the redirect names. So such a
 * request follows a redirect only to the server it was sent to: the same
 * address (scheme, host and port), or that address moved from http to
 * https on the default ports - the redirect a TLS front door answers plain
 * HTTP with. Any other redirect fails the request, and its error says
 * where the redirect pointed (its origin alone: a redirect's path or query
 * can carry anything).
 */

/*
 * The URL as the platform reads it. Read through globalThis because
 * modules of this package name their own URL type after it.
 */
type PlatformUrl = globalThis.URL;

function parse(address: string): PlatformUrl | null {
  try {
    return new globalThis.URL(address);
  } catch {
    return null;
  }
}

// A host and port, over http or https.
function isServerAddress(address: PlatformUrl): boolean {
  return (
    (address.protocol === "http:" || address.protocol === "https:") &&
    address.hostname !== ""
  );
}

// An address that names a user: never where a redirect may send a request.
function namesAUser(address: PlatformUrl): boolean {
  return address.username !== "" || address.password !== "";
}

export type IsRedirectOnSameServerFunction = (
  requestUrl: string,
  redirectUrl: string,
) => boolean;

/*
 * Whether a redirect from `requestUrl` to `redirectUrl` stays on the server
 * the request was sent to. Both are whole URLs; a URL's host is read
 * lower-case and its port is empty when it is the scheme's default.
 */
export const isRedirectOnSameServer: IsRedirectOnSameServerFunction = (
  requestUrl: string,
  redirectUrl: string,
): boolean => {
  const from: PlatformUrl | null = parse(requestUrl);
  const to: PlatformUrl | null = parse(redirectUrl);

  if (
    !from ||
    !to ||
    !isServerAddress(from) ||
    !isServerAddress(to) ||
    namesAUser(to)
  ) {
    return false;
  }

  if (to.hostname !== from.hostname) {
    return false;
  }

  if (to.protocol === from.protocol) {
    return to.port === from.port;
  }

  // http to https, from the default port to the default port.
  return (
    from.protocol === "http:" &&
    to.protocol === "https:" &&
    from.port === "" &&
    to.port === ""
  );
};

// An address's origin, the part of it an error may name, or null.
function originOf(address: string): string | null {
  const parsed: PlatformUrl | null = parse(address);

  if (!parsed || parsed.origin === "null") {
    return null;
  }

  return parsed.origin;
}

/*
 * Thrown from inside the HTTP client when a request would be redirected
 * off its server. The client fails the request with it.
 */
export class RedirectOffServerError extends Error {
  public constructor(data: { requestUrl: string; redirectUrl: string }) {
    const from: string = originOf(data.requestUrl) || "its server";
    const to: string | null = originOf(data.redirectUrl);

    super(
      to
        ? `The request to ${from} was redirected to ${to}, another server, so it was not sent on: a request that carries a key follows redirects only on the server it was sent to. If the server is at ${to}, set its address to that.`
        : `The request to ${from} was redirected to an address that could not be read, so it was not sent on: a request that carries a key follows redirects only on the server it was sent to.`,
    );
    this.name = "RedirectOffServerError";
  }
}

export type RedirectCheck = (redirectOptions: Record<string, unknown>) => void;

export type GetSameServerRedirectCheckFunction = (
  requestUrl: string,
) => RedirectCheck;

/*
 * The check to hand an HTTP client (axios's `beforeRedirect`) for a request
 * sent to `requestUrl`. The client calls it before each redirect it would
 * follow, with the redirect's address in `href`; every redirect of a chain
 * is held to the address the request was first sent to.
 */
export const getSameServerRedirectCheck: GetSameServerRedirectCheckFunction = (
  requestUrl: string,
): RedirectCheck => {
  return (redirectOptions: Record<string, unknown>): void => {
    const href: unknown = redirectOptions["href"];
    const redirectUrl: string = typeof href === "string" ? href : "";

    if (!isRedirectOnSameServer(requestUrl, redirectUrl)) {
      throw new RedirectOffServerError({
        requestUrl: requestUrl,
        redirectUrl: redirectUrl,
      });
    }
  };
};
