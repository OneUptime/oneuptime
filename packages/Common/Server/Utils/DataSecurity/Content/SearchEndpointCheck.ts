import {
  DataStorePostureFacts,
  DataStorePostureReadFrom,
} from "../../../../Types/DataSecurity/DataStorePosture";

/*
 * HOW EXPOSED A SEARCH CLUSTER IS, ASKED OF THE CLUSTER ITSELF (#11140).
 *
 * No cloud lists a cluster a team runs itself, so no cloud says who can
 * reach it. Its own endpoint can say some of that, and each content scan
 * asks it from where the scan runs - OneUptime's workers or a probe - with
 * read-only requests sent WITHOUT credentials, so nothing a person gave
 * OneUptime is sent and nothing is written:
 *
 *  1. who it takes an unauthenticated request to be: Elasticsearch's
 *     GET /_security/_authenticate, OpenSearch's GET
 *     /_plugins/_security/authinfo. 401 or 403: every request needs
 *     credentials. 200: anonymous access is on. An answer that the
 *     endpoint does not exist (400, 404, 405 - Elasticsearch 8 with
 *     security off answers 405 - or Elasticsearch 7's 500 "Security must
 *     be explicitly enabled"): the cluster has no access control at all;
 *  2. with anonymous access on, or none at all, a search for nothing
 *     (GET /_search?size=0&track_total_hits=1): how many documents
 *     whoever reaches it can read. Anonymous access on and nothing
 *     readable, while the scan's own user read documents, is no access;
 *  3. over https, the same address over plain http: an answer is a
 *     cluster that takes connections without TLS too; a dropped
 *     connection or a refusal is one that requires it. Over http, the
 *     scan's own connection was plaintext, so it does not.
 *
 * What it cannot know from there is said so (unknowableFacts): from inside
 * your network, whether the internet reaches the cluster; from anywhere,
 * what its firewall lets in, and whether those who reach it without
 * credentials can change its data when access control is on but grants
 * anonymous users some role - that takes a write to tell, and OneUptime
 * never writes. OneUptime Cloud's workers reach a store over the internet,
 * so a store they reach is reachable from it.
 *
 * The root (GET /) is not asked: with anonymous access on but no cluster
 * privilege, Elasticsearch answers it 403 while it serves every search.
 */

export type SearchEngineName = "elasticsearch" | "opensearch";

// An answer to one unauthenticated request, or why there was none.
export interface SearchEndpointAnswer {
  statusCode: number | null;
  bodyJson: unknown;
  bodyText: string;
  // Set when no answer came: the connection failed, was dropped or timed out.
  failure?: "timeout" | "dropped" | "unreachable" | undefined;
}

export interface SearchEndpointCheckInput {
  engine: SearchEngineName;
  isHttps: boolean;
  readFrom: DataStorePostureReadFrom;
  // The documents the scan's own user could read, or null when it could not count them.
  documentsReadableWithCredentials: number | null;
  // Sends one request without credentials, over the connection's scheme or plain http.
  ask: (request: {
    path: string;
    plaintext: boolean;
  }) => Promise<SearchEndpointAnswer>;
  now: Date;
}

export const WHO_AM_I_PATHS: Readonly<Record<SearchEngineName, string>> = {
  elasticsearch: "/_security/_authenticate",
  opensearch: "/_plugins/_security/authinfo",
};

export const ANONYMOUS_SEARCH_PATH: string =
  "/_search?size=0&track_total_hits=1";

// What an unauthenticated "who am I" answer says of the cluster's access control.
export enum SearchAccessControl {
  CredentialsRequired = "CredentialsRequired",
  AnonymousAllowed = "AnonymousAllowed",
  None = "None",
  Unknown = "Unknown",
}

const SECURITY_OFF_MESSAGE: RegExp =
  /security must be explicitly enabled|security is not enabled|no handler found/i;

export function readAccessControl(
  answer: SearchEndpointAnswer,
): SearchAccessControl {
  const status: number | null = answer.statusCode;

  if (status === null) {
    return SearchAccessControl.Unknown;
  }

  if (status === 401 || status === 403) {
    return SearchAccessControl.CredentialsRequired;
  }

  if (status >= 200 && status < 300) {
    return SearchAccessControl.AnonymousAllowed;
  }

  // The endpoint is not there: no security plugin, or security turned off.
  if (status === 400 || status === 404 || status === 405) {
    return SearchAccessControl.None;
  }

  if (status === 500 && SECURITY_OFF_MESSAGE.test(answer.bodyText)) {
    return SearchAccessControl.None;
  }

  return SearchAccessControl.Unknown;
}

// hits.total of a search answer: a number (6.x) or { value } (7.x and later).
export function readTotalHits(body: unknown): number | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const hits: unknown = (body as Record<string, unknown>)["hits"];

  if (!hits || typeof hits !== "object") {
    return null;
  }

  const total: unknown = (hits as Record<string, unknown>)["total"];

  if (typeof total === "number" && Number.isFinite(total)) {
    return total;
  }

  if (total && typeof total === "object") {
    const value: unknown = (total as Record<string, unknown>)["value"];

    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  return null;
}

/*
 * Whether a plaintext request to a TLS address was served: an answer of the
 * cluster's own - its data, or a refusal for missing credentials - says it
 * takes plaintext too. A proxy's "plain HTTP sent to an HTTPS port" (400,
 * nginx's 497) or a dropped connection says it requires TLS. A timeout says
 * nothing.
 */
export function readPlaintextServed(
  answer: SearchEndpointAnswer,
): boolean | null {
  if (answer.failure === "timeout") {
    return null;
  }

  if (answer.statusCode === null) {
    return false;
  }

  return (
    (answer.statusCode >= 200 && answer.statusCode < 300) ||
    answer.statusCode === 401 ||
    answer.statusCode === 403
  );
}

export async function checkSearchEndpoint(
  input: SearchEndpointCheckInput,
): Promise<DataStorePostureFacts> {
  const unknowable: Array<string> = [];
  const facts: DataStorePostureFacts = {
    readAt: input.now.toISOString(),
    readFrom: input.readFrom,
  };

  // 1. Who an unauthenticated request is.
  const access: SearchAccessControl = readAccessControl(
    await input.ask({ path: WHO_AM_I_PATHS[input.engine], plaintext: false }),
  );

  if (access === SearchAccessControl.CredentialsRequired) {
    facts.anonymousRead = false;
    facts.anonymousWrite = false;
  } else if (access === SearchAccessControl.Unknown) {
    facts.anonymousRead = null;
    facts.anonymousWrite = null;
  } else {
    // 2. What whoever reaches it can read.
    const search: SearchEndpointAnswer = await input.ask({
      path: ANONYMOUS_SEARCH_PATH,
      plaintext: false,
    });
    const status: number | null = search.statusCode;
    const isServed: boolean = status !== null && status >= 200 && status < 300;
    const isRefused: boolean = status === 401 || status === 403;

    if (access === SearchAccessControl.None) {
      /*
       * No access control of its own: a search it serves says every
       * request is taken, a write as well. Refused all the same, something
       * in front of it asks for credentials that the cluster does not.
       */
      facts.anonymousRead = isServed ? true : isRefused ? false : null;
      facts.anonymousWrite = isServed ? true : null;
    } else {
      const total: number | null = isServed
        ? readTotalHits(search.bodyJson)
        : null;

      facts.anonymousRead = isRefused
        ? false
        : total !== null && total > 0
          ? true
          : total === 0 && (input.documentsReadableWithCredentials || 0) > 0
            ? false
            : null;
      // Anonymous users hold some role: whether it writes takes a write to tell.
      facts.anonymousWrite = null;
      unknowable.push("anonymousWrite");
    }
  }

  /*
   * Nobody without credentials reads or changes it, so nobody on the
   * internet does: known from anywhere. Otherwise, whether everyone on the
   * internet reaches it is its firewall's to say.
   */
  facts.publicRead = facts.anonymousRead === false ? false : null;
  facts.publicWrite = facts.anonymousWrite === false ? false : null;

  if (facts.publicRead === null && facts.anonymousRead !== null) {
    unknowable.push("publicRead");
  }

  if (facts.publicWrite === null && facts.anonymousWrite !== null) {
    unknowable.push("publicWrite");
  }

  // Reached from OneUptime Cloud, over the internet: it takes connections from it.
  if (input.readFrom === DataStorePostureReadFrom.Internet) {
    facts.publicNetworkAccess = true;
  } else {
    facts.publicNetworkAccess = null;
    unknowable.push("publicNetworkAccess");
  }

  facts.openToAllAddresses = null;
  unknowable.push("openToAllAddresses");

  // 3. Whether it takes connections without TLS.
  if (!input.isHttps) {
    facts.encryptionInTransitEnforced = false;
  } else {
    const served: boolean | null = readPlaintextServed(
      await input.ask({ path: "/", plaintext: true }),
    );

    facts.encryptionInTransitEnforced = served === null ? null : !served;
    // Which TLS versions it takes needs a handshake of each: not asked.
    facts.minimumTlsVersion = null;
    unknowable.push("minimumTlsVersion");
  }

  facts.unknowableFacts = unknowable;

  return facts;
}
