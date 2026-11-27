import { describe, expect, test } from "@jest/globals";
import {
  ANONYMOUS_SEARCH_PATH,
  checkSearchEndpoint,
  readAccessControl,
  readPlaintextServed,
  readTotalHits,
  SearchAccessControl,
  SearchEndpointAnswer,
  SearchEngineName,
  WHO_AM_I_PATHS,
} from "../../../../Server/Utils/DataSecurity/Content/SearchEndpointCheck";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  DataStoreExposure,
  DataStorePostureFacts,
  DataStorePostureReadFrom,
  getDataStoreExposure,
} from "../../../../Types/DataSecurity/DataStorePosture";

/*
 * HOW EXPOSED A SEARCH CLUSTER IS, AS IT ANSWERS WITHOUT CREDENTIALS
 * (#11140).
 *
 * The answers here are the ones real clusters gave (the clusters suite,
 * SearchStoreSamplerClusters, holds them against running ones):
 * Elasticsearch 8 with security on answers its who-am-I 401, with
 * anonymous access 200, with security off 405; Elasticsearch 7 with
 * security off 500 "Security must be explicitly enabled"; OpenSearch with
 * its plugin off 400 "no handler found". Over TLS a plaintext request is
 * dropped. Held: what each answer makes of every fact, what is said to be
 * unknowable from where it was asked, and that nothing is asked that the
 * answers before it settled.
 */

const NOW: Date = new Date("2026-11-27T10:00:00.000Z");

interface Script {
  whoAmI?: SearchEndpointAnswer;
  search?: SearchEndpointAnswer;
  plaintext?: SearchEndpointAnswer;
}

function answer(
  statusCode: number | null,
  body?: unknown,
  failure?: SearchEndpointAnswer["failure"],
): SearchEndpointAnswer {
  return {
    statusCode,
    bodyJson: body,
    bodyText:
      body === undefined
        ? ""
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
    ...(failure ? { failure } : {}),
  };
}

function searchOf(total: number | { value: number }): SearchEndpointAnswer {
  return answer(200, { hits: { total, hits: [] } });
}

const DROPPED: SearchEndpointAnswer = answer(null, undefined, "dropped");

async function run(data: {
  script: Script;
  engine?: SearchEngineName;
  isHttps?: boolean;
  readFrom?: DataStorePostureReadFrom;
  documents?: number | null;
}): Promise<{ facts: DataStorePostureFacts; asked: Array<string> }> {
  const asked: Array<string> = [];
  const engine: SearchEngineName = data.engine || "elasticsearch";
  const facts: DataStorePostureFacts = await checkSearchEndpoint({
    engine,
    isHttps: data.isHttps ?? true,
    readFrom: data.readFrom || DataStorePostureReadFrom.Network,
    documentsReadableWithCredentials:
      data.documents === undefined ? 100 : data.documents,
    now: NOW,
    ask: async (request: {
      path: string;
      plaintext: boolean;
    }): Promise<SearchEndpointAnswer> => {
      asked.push(`${request.plaintext ? "http" : "tls"} ${request.path}`);

      if (request.plaintext) {
        return data.script.plaintext || DROPPED;
      }

      if (request.path === WHO_AM_I_PATHS[engine]) {
        return data.script.whoAmI || answer(null, undefined, "unreachable");
      }

      if (request.path === ANONYMOUS_SEARCH_PATH) {
        return data.script.search || answer(null, undefined, "unreachable");
      }

      throw new Error(`asked ${request.path}`);
    },
  });

  return { facts, asked };
}

describe("readAccessControl", () => {
  test("401 and 403 need credentials; 2xx lets anonymous users in", () => {
    expect(readAccessControl(answer(401))).toBe(
      SearchAccessControl.CredentialsRequired,
    );
    expect(readAccessControl(answer(403))).toBe(
      SearchAccessControl.CredentialsRequired,
    );
    expect(
      readAccessControl(answer(200, { username: "anonymous_user" })),
    ).toBe(SearchAccessControl.AnonymousAllowed);
  });

  test("an endpoint that is not there is a cluster with no access control", () => {
    // Elasticsearch 8, security off: GET is not the method it takes.
    expect(readAccessControl(answer(405))).toBe(SearchAccessControl.None);
    // OpenSearch, its security plugin off.
    expect(
      readAccessControl(
        answer(400, {
          error: "no handler found for uri [/_plugins/_security/authinfo]",
        }),
      ),
    ).toBe(SearchAccessControl.None);
    expect(readAccessControl(answer(404))).toBe(SearchAccessControl.None);
    // Elasticsearch 7, basic licence, security off.
    expect(
      readAccessControl(
        answer(500, {
          error: {
            reason:
              "Security must be explicitly enabled when using a [basic] license.",
          },
        }),
      ),
    ).toBe(SearchAccessControl.None);
  });

  test("any other answer, or none, says nothing", () => {
    expect(readAccessControl(answer(500, "oops"))).toBe(
      SearchAccessControl.Unknown,
    );
    expect(readAccessControl(answer(503))).toBe(SearchAccessControl.Unknown);
    expect(readAccessControl(DROPPED)).toBe(SearchAccessControl.Unknown);
  });
});

describe("readTotalHits", () => {
  test("reads 7.x's { value } and 6.x's number, and nothing else", () => {
    expect(readTotalHits({ hits: { total: { value: 12 } } })).toBe(12);
    expect(readTotalHits({ hits: { total: 3 } })).toBe(3);
    expect(readTotalHits({ hits: {} })).toBeNull();
    expect(readTotalHits({ hits: { total: "12" } })).toBeNull();
    expect(readTotalHits(null)).toBeNull();
    expect(readTotalHits("text")).toBeNull();
  });
});

describe("readPlaintextServed", () => {
  test("the cluster's own answer is plaintext served; a refusal or a dropped connection is TLS required", () => {
    expect(readPlaintextServed(answer(200, {}))).toBe(true);
    expect(readPlaintextServed(answer(401))).toBe(true);
    expect(readPlaintextServed(answer(403))).toBe(true);
    // nginx: "The plain HTTP request was sent to HTTPS port".
    expect(readPlaintextServed(answer(400))).toBe(false);
    expect(readPlaintextServed(answer(497))).toBe(false);
    expect(readPlaintextServed(DROPPED)).toBe(false);
    expect(readPlaintextServed(answer(null, undefined, "unreachable"))).toBe(
      false,
    );
  });

  test("a timeout says nothing", () => {
    expect(readPlaintextServed(answer(null, undefined, "timeout"))).toBeNull();
  });
});

describe("checkSearchEndpoint", () => {
  test("credentials required: nobody reads or changes it without them, from anywhere - and nothing more is asked", async () => {
    const { facts, asked } = await run({ script: { whoAmI: answer(401) } });

    expect(facts).toEqual({
      readAt: NOW.toISOString(),
      readFrom: DataStorePostureReadFrom.Network,
      anonymousRead: false,
      anonymousWrite: false,
      publicRead: false,
      publicWrite: false,
      publicNetworkAccess: null,
      openToAllAddresses: null,
      encryptionInTransitEnforced: true,
      minimumTlsVersion: null,
      unknowableFacts: [
        "publicNetworkAccess",
        "openToAllAddresses",
        "minimumTlsVersion",
      ],
    });
    // No anonymous search once the cluster refused who-am-I.
    expect(asked).toEqual(["tls /_security/_authenticate", "http /"]);
    // From inside the network, whether the internet reaches it is not known.
    expect(getDataStoreExposure(facts, DataStoreKind.Elasticsearch)).toBe(
      DataStoreExposure.Unknown,
    );
  });

  test("no access control at all: read and written by whoever reaches it", async () => {
    const { facts } = await run({
      isHttps: false,
      script: { whoAmI: answer(405), search: searchOf({ value: 5 }) },
    });

    expect(facts.anonymousRead).toBe(true);
    expect(facts.anonymousWrite).toBe(true);
    // Whoever reaches it, yes; the whole internet, its firewall says.
    expect(facts.publicRead).toBeNull();
    expect(facts.publicWrite).toBeNull();
    expect(facts.unknowableFacts).toEqual(
      expect.arrayContaining(["publicRead", "publicWrite"]),
    );
    expect(facts.encryptionInTransitEnforced).toBe(false);
    expect(facts.minimumTlsVersion).toBeUndefined();
  });

  test("no access control and nothing in it yet: still read by whoever reaches it", async () => {
    const { facts } = await run({
      isHttps: false,
      documents: 0,
      script: { whoAmI: answer(405), search: searchOf({ value: 0 }) },
    });

    expect(facts.anonymousRead).toBe(true);
    expect(facts.anonymousWrite).toBe(true);
  });

  test("no access control of its own, but a search refused: something in front asks for credentials", async () => {
    const { facts } = await run({
      script: { whoAmI: answer(404), search: answer(401) },
    });

    expect(facts.anonymousRead).toBe(false);
    expect(facts.anonymousWrite).toBeNull();
    expect(facts.publicRead).toBe(false);
    expect(facts.publicWrite).toBeNull();
    expect(facts.unknowableFacts).not.toContain("publicWrite");
  });

  test("anonymous access that reads documents: read without credentials, writing unknowable", async () => {
    const { facts } = await run({
      engine: "opensearch",
      script: {
        whoAmI: answer(200, { user_name: "opendistro_security_anonymous" }),
        search: searchOf({ value: 42 }),
      },
    });

    expect(facts.anonymousRead).toBe(true);
    expect(facts.anonymousWrite).toBeNull();
    expect(facts.unknowableFacts).toContain("anonymousWrite");
    expect(facts.publicRead).toBeNull();
    expect(facts.unknowableFacts).toContain("publicRead");
  });

  test("anonymous access that reads nothing the scan's user read: not read without credentials", async () => {
    const { facts } = await run({
      documents: 500,
      script: { whoAmI: answer(200), search: searchOf({ value: 0 }) },
    });

    expect(facts.anonymousRead).toBe(false);
    expect(facts.publicRead).toBe(false);
  });

  test("anonymous access to an empty cluster, or one the scan could not count: cannot tell", async () => {
    for (const documents of [0, null]) {
      const { facts } = await run({
        documents,
        script: { whoAmI: answer(200), search: searchOf({ value: 0 }) },
      });

      expect(facts.anonymousRead).toBeNull();
      expect(facts.unknowableFacts).not.toContain("publicRead");
    }
  });

  test("anonymous access, search refused: anonymous users hold no read", async () => {
    const { facts } = await run({
      script: { whoAmI: answer(200), search: answer(403) },
    });

    expect(facts.anonymousRead).toBe(false);
  });

  test("no usable answer to who-am-I: everything about credentials unknown, nothing claimed", async () => {
    const { facts, asked } = await run({
      script: { whoAmI: answer(503) },
    });

    expect(facts.anonymousRead).toBeNull();
    expect(facts.anonymousWrite).toBeNull();
    expect(facts.publicRead).toBeNull();
    expect(facts.publicWrite).toBeNull();
    // Plain unknown, not unknowable: another scan may tell.
    expect(facts.unknowableFacts).not.toContain("publicRead");
    expect(asked).not.toContain(`tls ${ANONYMOUS_SEARCH_PATH}`);
  });

  test("asked from outside every network (OneUptime Cloud), it is internet reachable", async () => {
    const { facts } = await run({
      readFrom: DataStorePostureReadFrom.Internet,
      script: { whoAmI: answer(401) },
    });

    expect(facts.readFrom).toBe(DataStorePostureReadFrom.Internet);
    expect(facts.publicNetworkAccess).toBe(true);
    expect(facts.unknowableFacts).not.toContain("publicNetworkAccess");
    // Whether only OneUptime's addresses are let in, its firewall says.
    expect(facts.openToAllAddresses).toBeNull();
    expect(facts.unknowableFacts).toContain("openToAllAddresses");
    expect(getDataStoreExposure(facts, DataStoreKind.Elasticsearch)).toBe(
      DataStoreExposure.InternetReachable,
    );
  });

  test("over TLS, a plaintext answer is TLS not required, and a timeout is unknown", async () => {
    const served: DataStorePostureFacts = (
      await run({
        script: { whoAmI: answer(401), plaintext: answer(401) },
      })
    ).facts;

    expect(served.encryptionInTransitEnforced).toBe(false);

    const timedOut: DataStorePostureFacts = (
      await run({
        script: {
          whoAmI: answer(401),
          plaintext: answer(null, undefined, "timeout"),
        },
      })
    ).facts;

    expect(timedOut.encryptionInTransitEnforced).toBeNull();
  });

  test("asks each engine at its own who-am-I", async () => {
    expect((await run({ script: { whoAmI: answer(401) } })).asked[0]).toBe(
      "tls /_security/_authenticate",
    );
    expect(
      (await run({ engine: "opensearch", script: { whoAmI: answer(401) } }))
        .asked[0],
    ).toBe("tls /_plugins/_security/authinfo");
  });

  test("never asks for anything but these three paths", async () => {
    const { asked } = await run({
      script: { whoAmI: answer(200), search: searchOf(7) },
    });

    for (const request of asked) {
      expect([
        "tls /_security/_authenticate",
        `tls ${ANONYMOUS_SEARCH_PATH}`,
        "http /",
      ]).toContain(request);
    }
  });
});
