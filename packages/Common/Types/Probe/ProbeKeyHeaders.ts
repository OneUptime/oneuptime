import Dictionary from "../Dictionary";

/*
 * A PROBE'S ID AND KEY, IN A REQUEST'S HEADERS (#10222).
 *
 * A probe proves who it is with its id and key in the body of every request
 * it sends (probeId and probeKey, ProbeAPIRequest.getDefaultRequestBody). A
 * vCenter's or an OpenStack cloud's collection is up to 48 MiB of JSON,
 * millions of values, and a key in a body can be checked only once the body
 * has been read. So a collection upload carries the two in these headers as
 * well, and OneUptime checks the key before it reads a byte of the body
 * (ProbeAuthorization.isAuthorizedFromHeadersMiddleware): a request with a
 * wrong key is refused unread, and only a probe whose key is right has its
 * millions of values parsed.
 *
 * Each value is URI-encoded, as the cluster key travels: an operator may set
 * PROBE_KEY to anything, and a header can carry neither a character beyond
 * Latin-1 nor the spaces at either end of a value.
 *
 * The body keeps both, for a OneUptime from before these headers, which
 * reads only the body.
 */

// Header names arrive lower-cased.
export const PROBE_ID_HEADER: string = "x-oneuptime-probe-id";
export const PROBE_KEY_HEADER: string = "x-oneuptime-probe-key";

// What a request's headers say of the probe that sent it.
export interface ProbeKeyHeadersRead {
  /*
   * The id and the key, decoded. Null for one the request does not carry,
   * carries empty, or carries in a form that is no URI-encoded text.
   */
  probeId: string | null;
  probeKey: string | null;
}

type HeaderValue = string | Array<string> | undefined;

export default class ProbeKeyHeaders {
  /*
   * The headers that carry a probe's id and key, URI-encoded: none for a
   * probe that has no key, whose requests OneUptime refuses whatever they
   * carry.
   */
  public static build(data: {
    probeId: string | null | undefined;
    probeKey: string | null | undefined;
  }): Dictionary<string> {
    if (!data.probeId || !data.probeKey) {
      return {};
    }

    return {
      [PROBE_ID_HEADER]: encodeURIComponent(data.probeId),
      [PROBE_KEY_HEADER]: encodeURIComponent(data.probeKey),
    };
  }

  /*
   * What a request's headers carry of its probe: null when they carry
   * neither header, as an older probe's do, whose key is in its body alone.
   */
  public static read(
    headers: Dictionary<HeaderValue> | undefined | null,
  ): ProbeKeyHeadersRead | null {
    const id: HeaderValue = headers?.[PROBE_ID_HEADER];
    const key: HeaderValue = headers?.[PROBE_KEY_HEADER];

    if (id === undefined && key === undefined) {
      return null;
    }

    return {
      probeId: ProbeKeyHeaders.decode(id),
      probeKey: ProbeKeyHeaders.decode(key),
    };
  }

  // A header's value, decoded: null when there is none to read.
  private static decode(value: HeaderValue): string | null {
    // A header sent twice arrives as a list (or joined): its first is read.
    const sent: string | undefined = Array.isArray(value) ? value[0] : value;

    if (typeof sent !== "string" || sent.length === 0) {
      return null;
    }

    try {
      const decoded: string = decodeURIComponent(sent);

      return decoded.length > 0 ? decoded : null;
    } catch {
      // Not URI-encoded text, so nothing a probe sends.
      return null;
    }
  }
}
