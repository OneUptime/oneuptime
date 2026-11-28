import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import OutboundUserAgent from "../../../../../Server/Utils/OutboundUserAgent";
import CrowdSecLapiClient, {
  CROWDSEC_BANS_PER_REQUEST,
  CROWDSEC_LOGIN_HINTS,
  CrowdSecAllowlist,
  CrowdSecBan,
  CrowdSecBanBatchResult,
  CrowdSecHeldDecision,
  getCrowdSecUserAgent,
  normalizeLapiUrl,
  parseGoDurationInMs,
} from "../../../../../Server/Utils/SecurityEvent/Response/CrowdSecLapiClient";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import {
  CROWDSEC_META_CONNECTION,
  CROWDSEC_ONEUPTIME_ORIGIN,
  CROWDSEC_ONEUPTIME_SCENARIO,
  CrowdSecScope,
} from "../../../../../Types/SecurityEvent/CrowdSec/CrowdSecDecisions";
import FakeCrowdSecLapi, {
  FakeLapiAlert,
  goDurationString,
  loopbackTransport,
} from "./FakeCrowdSecLapi";

/*
 * What OneUptime asks of CrowdSec's Local API (#11158), and how it reads
 * the answers: against answers recorded from LAPI's handlers at v1.8.2,
 * and over HTTP against a LAPI that answers as they do (FakeCrowdSecLapi).
 * The password and the token never leave in a message, a login is refused
 * for the reasons LAPI refuses one with a hint for each, only this
 * connection's bans are read back, and a ban is written as
 * `cscli decisions add` writes one.
 */

const MACHINE: string = "oneuptime";
const PASSWORD: string = "Rv8n2Qw7xKp4Lm9ZtY3sB6dF";
const CONNECTION: string = "6d0c1d4e-1f6e-4c1d-9a3b-111111111111";
const OTHER_CONNECTION: string = "6d0c1d4e-1f6e-4c1d-9a3b-222222222222";

type Responder = (request: DataSourceHttpRequest) => DataSourceHttpResponse;

function respond(statusCode: number, body: unknown): DataSourceHttpResponse {
  const bodyText: string =
    typeof body === "string" ? body : JSON.stringify(body);

  return {
    statusCode,
    bodyText,
    bodyJson: typeof body === "string" ? undefined : body,
  };
}

function recorded(responder: Responder): {
  client: CrowdSecLapiClient;
  requests: Array<DataSourceHttpRequest>;
} {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    client: new CrowdSecLapiClient({
      lapiUrl: "https://lapi.example.com:8080/",
      machineId: MACHINE,
      password: PASSWORD,
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        requests.push(request);

        if (request.url.endsWith("/v1/watchers/login")) {
          return respond(200, {
            code: 200,
            expire: "2026-11-28T11:00:00Z",
            token: "eyJhbGciOiJIUzI1NiJ9.recorded.token",
          });
        }

        return responder(request);
      },
    }),
  };
}

function ban(value: string, overrides?: Partial<CrowdSecBan>): CrowdSecBan {
  return {
    scope: value.includes("/") ? CrowdSecScope.Range : CrowdSecScope.Ip,
    value,
    durationInSeconds: 86400,
    message: "OneUptime case CASE-12 until 2026-11-29 10:00 UTC",
    meta: [{ key: CROWDSEC_META_CONNECTION, value: CONNECTION }],
    ...(overrides || {}),
  };
}

describe("the Local API's URL", () => {
  test("is read the way people paste it, with or without /v1", () => {
    expect(normalizeLapiUrl("http://127.0.0.1:8080/")).toBe(
      "http://127.0.0.1:8080",
    );
    expect(normalizeLapiUrl(" https://lapi.example.com:8080/v1/ ")).toBe(
      "https://lapi.example.com:8080",
    );
    expect(normalizeLapiUrl("https://example.com/crowdsec/v1")).toBe(
      "https://example.com/crowdsec",
    );
  });

  test("refuses what would break every call", () => {
    for (const bad of [
      "",
      "lapi:8080",
      "ftp://lapi.example.com",
      "https://lapi.example.com/?x=1",
      "https://lapi.example.com/#x",
      "https://user:pass@lapi.example.com",
    ]) {
      expect(() => {
        return normalizeLapiUrl(bad);
      }).toThrow();
    }
  });
});

describe("the User-Agent LAPI takes a login from", () => {
  test("is one name and one version, never the product's usual one", () => {
    expect(getCrowdSecUserAgent("18.0.0")).toBe("OneUptime/18.0.0");
    expect(getCrowdSecUserAgent("")).toBe("OneUptime/dev");
    expect(getCrowdSecUserAgent("unknown")).toBe("OneUptime/dev");
    expect(getCrowdSecUserAgent("1.2/3 (x)")).toBe("OneUptime/1.23x");

    for (const version of ["18.0.0", "", "1.2/3 (x)"]) {
      expect(getCrowdSecUserAgent(version).split("/")).toHaveLength(2);
    }

    // What every other outbound request sends: LAPI refuses it (jwt.go).
    expect(OutboundUserAgent.build("18.0.0").split("/").length).not.toBe(2);
  });
});

describe("a Go duration, as LAPI writes one", () => {
  test.each([
    ["4h", 4 * 3600 * 1000],
    ["3h57m38s", (3 * 3600 + 57 * 60 + 38) * 1000],
    ["1m0s", 60 * 1000],
    ["0s", 0],
    ["0", 0],
    ["1.5s", 1500],
    ["250ms", 250],
    ["-1m2s", -62 * 1000],
    ["167h59m59s", (167 * 3600 + 59 * 60 + 59) * 1000],
  ])("%s", (text: string, ms: number) => {
    expect(parseGoDurationInMs(text)).toBeCloseTo(ms, 5);
  });

  test("nothing from what is no duration", () => {
    for (const bad of ["", "soon", "4", "h4", "4 h", "4x"]) {
      expect(parseGoDurationInMs(bad)).toBeNull();
    }
  });
});

describe("against LAPI's recorded answers", () => {
  test("a login sends the machine and its password, once, and no scenarios", async () => {
    const { client, requests } = recorded((): DataSourceHttpResponse => {
      return respond(200, []);
    });

    await client.listOwnBans(CONNECTION);
    await client.listOwnBans(CONNECTION);

    const logins: Array<DataSourceHttpRequest> = requests.filter(
      (request: DataSourceHttpRequest): boolean => {
        return request.url.endsWith("/v1/watchers/login");
      },
    );

    expect(logins).toHaveLength(1);
    expect(logins[0]?.url).toBe(
      "https://lapi.example.com:8080/v1/watchers/login",
    );
    expect(JSON.parse(String(logins[0]?.body))).toEqual({
      machine_id: MACHINE,
      password: PASSWORD,
    });
    expect(logins[0]?.headers?.["User-Agent"]?.split("/")).toHaveLength(2);
    expect(requests[1]?.headers?.["Authorization"]).toBe(
      "Bearer eyJhbGciOiJIUzI1NiJ9.recorded.token",
    );
  });

  test("reads its bans with the filters LAPI knows, every one of them (limit 0)", async () => {
    const { client, requests } = recorded((): DataSourceHttpResponse => {
      return respond(200, []);
    });

    await client.listOwnBans(CONNECTION);

    const url: URL = new URL(requests[1]!.url);
    expect(url.pathname).toBe("/v1/alerts");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scenario: CROWDSEC_ONEUPTIME_SCENARIO,
      origin: CROWDSEC_ONEUPTIME_ORIGIN,
      has_active_decision: "true",
      limit: "0",
    });
  });

  test("keeps this connection's bans in force, and nobody else's", async () => {
    const now: Date = new Date("2026-11-28T10:00:00.000Z");
    const alert: (data: {
      id: number;
      connection?: string | undefined;
      decisions: JSONArray;
    }) => JSONObject = (data: {
      id: number;
      connection?: string | undefined;
      decisions: JSONArray;
    }): JSONObject => {
      return {
        id: data.id,
        scenario: CROWDSEC_ONEUPTIME_SCENARIO,
        meta: data.connection
          ? [{ key: CROWDSEC_META_CONNECTION, value: data.connection }]
          : [],
        decisions: data.decisions,
      };
    };
    const decision: (
      id: number,
      duration: string,
      extra?: JSONObject,
    ) => JSONObject = (
      id: number,
      duration: string,
      extra?: JSONObject,
    ): JSONObject => {
      return {
        id,
        duration,
        origin: CROWDSEC_ONEUPTIME_ORIGIN,
        scenario: CROWDSEC_ONEUPTIME_SCENARIO,
        scope: "Ip",
        type: "ban",
        value: `192.0.2.${id}`,
        ...(extra || {}),
      };
    };

    const { client } = recorded((): DataSourceHttpResponse => {
      return respond(200, [
        alert({
          id: 1,
          connection: CONNECTION,
          decisions: [decision(11, "23h59m58s"), decision(12, "-5m0s")],
        }),
        alert({
          id: 2,
          connection: OTHER_CONNECTION,
          decisions: [decision(21, "4h")],
        }),
        alert({ id: 3, decisions: [decision(31, "4h")] }),
        alert({
          id: 4,
          connection: CONNECTION,
          decisions: [
            decision(41, "4h", { scenario: "manual 'ban' from 'oneuptime'" }),
            decision(42, "4h", { origin: "crowdsec" }),
          ],
        }),
      ]);
    });

    const held: Array<CrowdSecHeldDecision> = await client.listOwnBans(
      CONNECTION,
      now,
    );

    expect(
      held.map((item: CrowdSecHeldDecision) => {
        return [
          item.id,
          item.alertId,
          item.value,
          item.expiresAt?.toISOString(),
        ];
      }),
    ).toEqual([["11", "1", "192.0.2.11", "2026-11-29T09:59:58.000Z"]]);

    // With no connection: every one of OneUptime's, whichever connection made it.
    const all: Array<CrowdSecHeldDecision> = await client.listOwnBans(
      null,
      now,
    );
    expect(
      all.map((item: CrowdSecHeldDecision) => {
        return item.id;
      }),
    ).toEqual(["11", "21"]);
  });

  test("a LAPI that answers alerts with something else is read as a failure, not as no bans", async () => {
    const { client } = recorded((): DataSourceHttpResponse => {
      return respond(200, { message: "maintenance" });
    });

    await expect(client.listOwnBans(CONNECTION)).rejects.toThrow(
      "returned something other than a list of alerts",
    );
  });

  test("bans as cscli decisions add does: an alert per ban, one ban decision each, a hundred to a request", async () => {
    const posted: Array<JSONArray> = [];
    const { client } = recorded(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        const body: JSONArray = JSON.parse(String(request.body)) as JSONArray;
        posted.push(body);
        return respond(
          201,
          body.map((_item: unknown, index: number): string => {
            return String(posted.length * 1000 + index);
          }),
        );
      },
    );

    const bans: Array<CrowdSecBan> = [];

    for (
      let index: number = 0;
      index < CROWDSEC_BANS_PER_REQUEST + 3;
      index++
    ) {
      bans.push(ban(`198.51.100.${index % 250}`));
    }

    bans.push(ban("203.0.113.0/24", { durationInSeconds: 0.2 }));

    const results: Array<CrowdSecBanBatchResult> = await client.addBans(
      bans,
      new Date("2026-11-28T10:00:00.123Z"),
    );

    expect(
      posted.map((body: JSONArray) => {
        return body.length;
      }),
    ).toEqual([CROWDSEC_BANS_PER_REQUEST, 4]);
    expect(
      results.map((result: CrowdSecBanBatchResult) => {
        return result.isDone;
      }),
    ).toEqual([true, true]);

    expect(posted[0]![0]).toEqual({
      scenario: CROWDSEC_ONEUPTIME_SCENARIO,
      scenario_hash: "",
      scenario_version: "",
      message: "OneUptime case CASE-12 until 2026-11-29 10:00 UTC",
      events_count: 1,
      events: [],
      start_at: "2026-11-28T10:00:00Z",
      stop_at: "2026-11-28T10:00:00Z",
      capacity: 0,
      leakspeed: "0",
      simulated: false,
      remediation: true,
      kind: "cscli",
      source: { scope: "Ip", value: "198.51.100.0", ip: "198.51.100.0" },
      decisions: [
        {
          duration: "86400s",
          origin: "cscli",
          scenario: CROWDSEC_ONEUPTIME_SCENARIO,
          scope: "Ip",
          type: "ban",
          value: "198.51.100.0",
        },
      ],
      meta: [{ key: CROWDSEC_META_CONNECTION, value: CONNECTION }],
    });

    // A range, and a ban of less than a second: at least one second.
    const range: JSONObject = posted[1]![3] as JSONObject;
    expect(range["source"]).toEqual({
      scope: "Range",
      value: "203.0.113.0/24",
      range: "203.0.113.0/24",
    });
    expect((range["decisions"] as Array<JSONObject>)[0]?.["duration"]).toBe(
      "1s",
    );
  });

  test("a batch LAPI refuses says why, scrubbed of the password and the token", async () => {
    const { client } = recorded((): DataSourceHttpResponse => {
      return respond(500, {
        message: `validation failure list: machine oneuptime password ${PASSWORD} token eyJhbGciOiJIUzI1NiJ9.recorded.token`,
      });
    });

    const results: Array<CrowdSecBanBatchResult> = await client.addBans([
      ban("192.0.2.1"),
    ]);

    expect(results[0]?.isDone).toBe(false);
    expect(results[0]?.error).toContain(
      "CrowdSec Local API ban failed (HTTP 500)",
    );
    expect(results[0]?.error).not.toContain(PASSWORD);
    expect(results[0]?.error).not.toContain(
      "eyJhbGciOiJIUzI1NiJ9.recorded.token",
    );
  });

  test("a decision LAPI no longer has is gone, as it answers it", async () => {
    const { client } = recorded((): DataSourceHttpResponse => {
      return respond(500, {
        message: "decision with id '7' doesn't exist: unable to delete",
      });
    });

    await expect(client.deleteDecision("7")).resolves.toBeUndefined();
  });

  test("a decision delete that fails for another reason says so", async () => {
    const { client } = recorded((): DataSourceHttpResponse => {
      return respond(500, { message: "database is locked" });
    });

    await expect(client.deleteDecision("7")).rejects.toThrow(
      "CrowdSec Local API decision delete failed (HTTP 500)",
    );
  });

  test("no decision without its id: nothing is sent", async () => {
    const { client, requests } = recorded((): DataSourceHttpResponse => {
      return respond(200, { nbDeleted: "1" });
    });

    await expect(client.deleteDecision("")).rejects.toThrow(
      "does not know which CrowdSec decision holds it",
    );
    await expect(client.deleteDecision("../alerts")).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  test("reads the allowlists' addresses and ranges, and none from a LAPI older than allowlists", async () => {
    const { client } = recorded((): DataSourceHttpResponse => {
      return respond(200, [
        {
          name: "office",
          allowlist_id: "a1",
          items: [
            { value: "198.51.100.10", expiration: "0001-01-01T00:00:00.000Z" },
            { value: "203.0.113.0/24" },
            { description: "no value" },
          ],
        },
        { name: "empty", items: null },
      ]);
    });

    const lists: Array<CrowdSecAllowlist> = await client.readAllowlists();
    expect(lists).toEqual([
      { name: "office", values: ["198.51.100.10", "203.0.113.0/24"] },
      { name: "empty", values: [] },
    ]);

    const old: CrowdSecLapiClient = recorded((): DataSourceHttpResponse => {
      return respond(404, "404 page not found");
    }).client;
    await expect(old.readAllowlists()).resolves.toEqual([]);
  });

  test("each way LAPI refuses a login says what to do", async () => {
    const cases: Array<[string, string]> = [
      ["incorrect Username or Password", CROWDSEC_LOGIN_HINTS.password],
      ["machine oneuptime not validated", CROWDSEC_LOGIN_HINTS.validated],
      ["ent: machine not found", CROWDSEC_LOGIN_HINTS.missing],
      [
        "machine oneuptime attempted to auth with password but it is configured to use tls",
        CROWDSEC_LOGIN_HINTS.method,
      ],
    ];

    for (const [message, hint] of cases) {
      const client: CrowdSecLapiClient = new CrowdSecLapiClient({
        lapiUrl: "https://lapi.example.com",
        machineId: MACHINE,
        password: PASSWORD,
        transport: async (): Promise<DataSourceHttpResponse> => {
          return respond(401, { code: 401, message });
        },
      });

      await expect(client.login()).rejects.toThrow(hint);
      await expect(client.login()).rejects.toThrow(
        "CrowdSec Local API login failed (HTTP 401)",
      );
    }
  });

  test("a login answered without a token is no login", async () => {
    const client: CrowdSecLapiClient = new CrowdSecLapiClient({
      lapiUrl: "https://lapi.example.com",
      machineId: MACHINE,
      password: PASSWORD,
      transport: async (): Promise<DataSourceHttpResponse> => {
        return respond(200, "<html>sign in</html>");
      },
    });

    await expect(client.login()).rejects.toThrow("returned no token");
  });

  test("a LAPI that cannot be reached says so, and never with the password", async () => {
    const client: CrowdSecLapiClient = new CrowdSecLapiClient({
      lapiUrl: "https://lapi.example.com",
      machineId: MACHINE,
      password: PASSWORD,
      transport: async (): Promise<DataSourceHttpResponse> => {
        throw new Error(
          `Could not reach data source: connect ECONNREFUSED (${PASSWORD})`,
        );
      },
    });

    const error: unknown = await client.login().catch((caught: unknown) => {
      return caught;
    });

    expect(String(error)).toContain(
      "CrowdSec Local API login could not be completed",
    );
    expect(String(error)).not.toContain(PASSWORD);
  });
});

describe("over HTTP, against a LAPI that answers as v1.8.2 does", () => {
  let lapi: FakeCrowdSecLapi;
  let url: string;

  function client(overrides?: {
    password?: string;
    userAgent?: string;
  }): CrowdSecLapiClient {
    return new CrowdSecLapiClient({
      lapiUrl: `${url}/`,
      machineId: MACHINE,
      password: overrides?.password || PASSWORD,
      transport: loopbackTransport,
      ...(overrides?.userAgent ? { userAgent: overrides.userAgent } : {}),
    });
  }

  beforeEach(async () => {
    lapi = new FakeCrowdSecLapi();
    lapi.addMachine(MACHINE, { password: PASSWORD });
    url = await lapi.start();
  });

  afterEach(async () => {
    await lapi.stop();
  });

  test("its health answers without a sign-in", async () => {
    await expect(client().readHealth()).resolves.toBeUndefined();
    expect(lapi.requests[0]?.headers["authorization"]).toBeUndefined();
  });

  test("signs in with the User-Agent LAPI takes, where the product's usual one is refused", async () => {
    await expect(client().login()).resolves.toBeUndefined();

    await expect(
      client({ userAgent: OutboundUserAgent.build("18.0.0") }).login(),
    ).rejects.toThrow("incorrect Username or Password");
  });

  test("a wrong password, a machine not validated, one that does not exist", async () => {
    await expect(
      client({ password: "wrong-password" }).login(),
    ).rejects.toThrow(CROWDSEC_LOGIN_HINTS.password);

    lapi.addMachine(MACHINE, { password: PASSWORD, isValidated: false });
    await expect(client().login()).rejects.toThrow(
      CROWDSEC_LOGIN_HINTS.validated,
    );

    lapi.machines.delete(MACHINE);
    await expect(client().login()).rejects.toThrow(
      CROWDSEC_LOGIN_HINTS.missing,
    );
  });

  test("a ban made is held until its end, and read back as this connection's", async () => {
    const lapiClient: CrowdSecLapiClient = client();

    const results: Array<CrowdSecBanBatchResult> = await lapiClient.addBans(
      [ban("192.0.2.44", { durationInSeconds: 3600 })],
      lapi.getNow(),
    );

    expect(results[0]?.isDone).toBe(true);
    expect(results[0]?.alertIds).toEqual(["1"]);

    const active: Array<{
      value: string;
      until: Date;
      origin: string;
      scenario: string;
      alert: FakeLapiAlert;
    }> = lapi.activeDecisions();
    expect(active).toHaveLength(1);
    expect(active[0]?.value).toBe("192.0.2.44");
    expect(active[0]?.origin).toBe("cscli");
    expect(active[0]?.scenario).toBe(CROWDSEC_ONEUPTIME_SCENARIO);
    expect(active[0]?.alert.machineId).toBe(MACHINE);
    expect(active[0]?.until.toISOString()).toBe("2026-11-28T11:00:00.000Z");

    // Half an hour on, it has half an hour left.
    lapi.setNow(new Date("2026-11-28T10:30:00.000Z"));
    const held: Array<CrowdSecHeldDecision> = await lapiClient.listOwnBans(
      CONNECTION,
      lapi.getNow(),
    );

    expect(held).toHaveLength(1);
    expect(held[0]?.duration).toBe(goDurationString(30 * 60 * 1000));
    expect(held[0]?.expiresAt?.toISOString()).toBe("2026-11-28T11:00:00.000Z");
    expect(held[0]?.meta.get(CROWDSEC_META_CONNECTION)).toEqual([CONNECTION]);
  });

  test("a person's ban, CrowdSec's own and another connection's are never read back", async () => {
    lapi.addDecisionAlert({
      machineId: "localhost",
      scenario: "manual 'ban' from 'localhost'",
      origin: "cscli",
      value: "198.51.100.1",
      durationInMs: 3600000,
    });
    lapi.addDecisionAlert({
      machineId: "localhost",
      scenario: "crowdsecurity/ssh-bf",
      origin: "crowdsec",
      value: "198.51.100.2",
      durationInMs: 3600000,
    });
    lapi.addDecisionAlert({
      machineId: MACHINE,
      scenario: CROWDSEC_ONEUPTIME_SCENARIO,
      origin: "cscli",
      value: "198.51.100.3",
      durationInMs: 3600000,
      meta: [{ key: CROWDSEC_META_CONNECTION, value: OTHER_CONNECTION }],
    });

    expect(await client().listOwnBans(CONNECTION, lapi.getNow())).toEqual([]);
  });

  test("a decision ended is no longer read back, and ending it again is done", async () => {
    const lapiClient: CrowdSecLapiClient = client();
    await lapiClient.addBans([ban("192.0.2.45")], lapi.getNow());

    const held: Array<CrowdSecHeldDecision> = await lapiClient.listOwnBans(
      CONNECTION,
      lapi.getNow(),
    );
    await lapiClient.deleteDecision(held[0]!.id);

    expect(lapi.activeDecisions()).toEqual([]);
    expect(await lapiClient.listOwnBans(CONNECTION, lapi.getNow())).toEqual([]);

    // LAPI expires, it does not delete: ending it twice is done twice.
    await expect(
      lapiClient.deleteDecision(held[0]!.id),
    ).resolves.toBeUndefined();
    // One it never had: "doesn't exist", which is gone.
    await expect(lapiClient.deleteDecision("9999")).resolves.toBeUndefined();
  });

  test("an address LAPI cannot read is dropped from its alert, so only a read back says it was not banned", async () => {
    const lapiClient: CrowdSecLapiClient = client();
    const results: Array<CrowdSecBanBatchResult> = await lapiClient.addBans(
      [ban("not-an-address")],
      lapi.getNow(),
    );

    expect(results[0]?.isDone).toBe(true);
    expect(await lapiClient.listOwnBans(CONNECTION, lapi.getNow())).toEqual([]);
  });

  test("a token that lapsed mid-pass is renewed once, and the call goes through", async () => {
    const lapiClient: CrowdSecLapiClient = client();
    await lapiClient.login();
    lapi.expireTokens();

    await expect(
      lapiClient.listOwnBans(CONNECTION, lapi.getNow()),
    ).resolves.toEqual([]);
    expect(
      lapi.requests.filter((request: { path: string }) => {
        return request.path === "/v1/watchers/login";
      }),
    ).toHaveLength(2);
  });

  test("allowlists, and none on a LAPI older than them", async () => {
    lapi.allowlists = [
      {
        name: "office",
        items: [
          { value: "198.51.100.10" },
          { value: "203.0.113.0/24" },
          { value: "192.0.2.99", expiration: new Date("2026-01-01T00:00:00Z") },
        ],
      },
    ];

    expect(await client().readAllowlists()).toEqual([
      { name: "office", values: ["198.51.100.10", "203.0.113.0/24"] },
    ]);

    lapi.hasAllowlists = false;
    expect(await client().readAllowlists()).toEqual([]);
  });

  test("every message OneUptime sends LAPI is JSON, and none carries the password but the login", async () => {
    const lapiClient: CrowdSecLapiClient = client();
    await lapiClient.addBans([ban("192.0.2.46")], lapi.getNow());
    await lapiClient.listOwnBans(CONNECTION, lapi.getNow());
    await lapiClient.readAllowlists();

    for (const request of lapi.requests) {
      if (request.body) {
        expect(request.headers["content-type"]).toBe("application/json");
      }

      if (request.path !== "/v1/watchers/login") {
        expect(request.body).not.toContain(PASSWORD);
        expect(request.path).not.toContain(PASSWORD);
      }
    }
  });
});
