import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import CrowdStrikeFalconResponseClient, {
  falconQuotedValue,
} from "../../../../../Server/Utils/SecurityEvent/Response/CrowdStrikeFalconResponseClient";
import MicrosoftDefenderEndpointClient, {
  DefenderMachine,
  odataQuotedValue,
} from "../../../../../Server/Utils/SecurityEvent/Response/MicrosoftDefenderEndpointClient";
import OktaResponseClient, {
  OktaContainmentOutcome,
  OktaUser,
} from "../../../../../Server/Utils/SecurityEvent/Response/OktaResponseClient";
import ResponseHttp from "../../../../../Server/Utils/SecurityEvent/Response/ResponseHttp";
import { describe, expect, test } from "@jest/globals";

/*
 * The containment clients' request contracts, against a recording
 * transport: the method, URL, headers and body each vendor documents, and
 * every error worded so an analyst knows what to fix - with the secret
 * never in it.
 */

type Responder = (request: DataSourceHttpRequest) => DataSourceHttpResponse;

interface RecordingTransport {
  requests: Array<DataSourceHttpRequest>;
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>;
}

function respond(statusCode: number, body: unknown): DataSourceHttpResponse {
  const bodyText: string = body === undefined ? "" : JSON.stringify(body);
  return { statusCode, bodyText, bodyJson: body };
}

function recording(responder: Responder): RecordingTransport {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      return responder(request);
    },
  };
}

describe("ResponseHttp", () => {
  test("reads the status out of the guarded fetch's thrown error", async () => {
    const result: { statusCode: number; bodyJson: unknown } =
      await ResponseHttp.send({
        transport: async (): Promise<DataSourceHttpResponse> => {
          throw new Error(
            'Data source responded with HTTP 403: {"errorSummary":"nope"}',
          );
        },
        request: { method: "GET", url: "https://x.example" },
        step: "Test step",
        secrets: [],
      });

    expect(result.statusCode).toBe(403);
    expect(result.bodyJson).toEqual({ errorSummary: "nope" });
  });

  test("says where a request without a status stopped, with secrets scrubbed", async () => {
    await expect(
      ResponseHttp.send({
        transport: async (): Promise<DataSourceHttpResponse> => {
          throw new Error("timeout while sending token SECRET-VALUE-123");
        },
        request: { method: "GET", url: "https://x.example" },
        step: "Okta user lookup",
        secrets: ["SECRET-VALUE-123"],
      }),
    ).rejects.toThrow(
      /Okta user lookup could not be completed: .*\[REDACTED\]/,
    );
  });

  test("scrubs every occurrence of every secret, and ignores ones too short to matter", () => {
    expect(ResponseHttp.scrub("a abcd b abcd", ["abcd", "ab"])).toBe(
      "a [REDACTED] b [REDACTED]",
    );
  });
});

describe("OktaResponseClient", () => {
  const ORG: string = "https://acme.okta.com/";
  const TOKEN: string = "00okta-token-abcdef";

  test("finds a user by login, URL-encoded, with the SSWS token", async () => {
    const { requests, transport } = recording(() => {
      return respond(200, {
        id: "00u1",
        status: "ACTIVE",
        profile: { login: "alice@acme.com" },
      });
    });

    const user: OktaUser | null = await new OktaResponseClient({
      orgUrl: ORG,
      apiToken: TOKEN,
      transport,
    }).findUser("alice@acme.com");

    expect(user).toEqual({
      id: "00u1",
      status: "ACTIVE",
      login: "alice@acme.com",
    });
    expect(requests[0]).toMatchObject({
      method: "GET",
      url: "https://acme.okta.com/api/v1/users/alice%40acme.com",
    });
    expect(requests[0]!.headers?.["Authorization"]).toBe(`SSWS ${TOKEN}`);
  });

  test("reads Okta's 404 as no such user", async () => {
    const { transport } = recording(() => {
      return respond(404, { errorCode: "E0000007" });
    });

    expect(
      await new OktaResponseClient({
        orgUrl: ORG,
        apiToken: TOKEN,
        transport,
      }).findUser("nobody"),
    ).toBeNull();
  });

  test("suspends an active user with a POST to its lifecycle", async () => {
    const { requests, transport } = recording(() => {
      return respond(200, {});
    });

    const outcome: OktaContainmentOutcome = await new OktaResponseClient({
      orgUrl: ORG,
      apiToken: TOKEN,
      transport,
    }).suspendUser({ id: "00u1", status: "ACTIVE", login: "alice" });

    expect(outcome).toBe(OktaContainmentOutcome.Done);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://acme.okta.com/api/v1/users/00u1/lifecycle/suspend",
    });
  });

  test("leaves a suspended user alone and says so", async () => {
    const { requests, transport } = recording(() => {
      return respond(200, {});
    });

    expect(
      await new OktaResponseClient({
        orgUrl: ORG,
        apiToken: TOKEN,
        transport,
      }).suspendUser({
        id: "00u1",
        status: "SUSPENDED",
        login: "alice",
      }),
    ).toBe(OktaContainmentOutcome.AlreadyDone);
    expect(requests).toHaveLength(0);
  });

  test("ends sessions and revokes OAuth tokens with a DELETE", async () => {
    const { requests, transport } = recording(() => {
      return respond(204, undefined);
    });

    await new OktaResponseClient({
      orgUrl: ORG,
      apiToken: TOKEN,
      transport,
    }).endSessions({
      id: "00u1",
      status: "ACTIVE",
      login: "alice",
    });

    expect(requests[0]).toMatchObject({
      method: "DELETE",
      url: "https://acme.okta.com/api/v1/users/00u1/sessions?oauthTokens=true",
    });
    expect(requests[0]!.body).toBeUndefined();
  });

  test("explains a 403 and never echoes the token", async () => {
    const { transport } = recording(() => {
      return respond(403, { errorSummary: `denied for ${TOKEN}` });
    });

    const promise: Promise<unknown> = new OktaResponseClient({
      orgUrl: ORG,
      apiToken: TOKEN,
      transport,
    }).suspendUser({ id: "00u1", status: "ACTIVE", login: "alice" });

    await expect(promise).rejects.toThrow(/HTTP 403.*cannot suspend this user/);
    await expect(promise).rejects.not.toThrow(new RegExp(TOKEN));
  });
});

describe("CrowdStrikeFalconResponseClient", () => {
  const SECRET: string = "falcon-client-secret-xyz";

  function falcon(responder: Responder): {
    client: CrowdStrikeFalconResponseClient;
    requests: Array<DataSourceHttpRequest>;
  } {
    const { requests, transport } = recording(
      (request: DataSourceHttpRequest) => {
        if (request.url.endsWith("/oauth2/token")) {
          return respond(201, {
            access_token: "falcon-token",
            expires_in: 1799,
          });
        }

        return responder(request);
      },
    );

    return {
      client: new CrowdStrikeFalconResponseClient({
        cloud: "eu-1",
        clientId: "client-id",
        clientSecret: SECRET,
        transport,
      }),
      requests,
    };
  }

  test("quotes a hostname for FQL, backslashes and quotes escaped", () => {
    expect(falconQuotedValue("web-01")).toBe("'web-01'");
    expect(falconQuotedValue("a'b\\c")).toBe("'a\\'b\\\\c'");
  });

  test("gets a token once, then finds devices by hostname on the configured cloud", async () => {
    const { client, requests } = falcon(() => {
      return respond(200, { resources: ["dev1", "dev2"] });
    });

    expect(await client.findDeviceIds("web-01")).toEqual(["dev1", "dev2"]);
    expect(await client.findDeviceIds("web-02")).toEqual(["dev1", "dev2"]);

    const tokenRequests: Array<DataSourceHttpRequest> = requests.filter(
      (request: DataSourceHttpRequest) => {
        return request.url.endsWith("/oauth2/token");
      },
    );

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]).toMatchObject({
      method: "POST",
      url: "https://api.eu-1.crowdstrike.com/oauth2/token",
      formUrlEncoded: true,
    });

    const lookup: DataSourceHttpRequest = requests[1]!;
    const url: URL = new URL(lookup.url);

    expect(url.origin + url.pathname).toBe(
      "https://api.eu-1.crowdstrike.com/devices/queries/devices/v1",
    );
    expect(url.searchParams.get("filter")).toBe("hostname:'web-01'");
    expect(lookup.headers?.["Authorization"]).toBe("Bearer falcon-token");
  });

  test("contains devices with the documented action", async () => {
    const { client, requests } = falcon(() => {
      return respond(202, { resources: [{ id: "dev1" }] });
    });

    await client.containDevices(["dev1"]);

    const contain: DataSourceHttpRequest = requests[requests.length - 1]!;

    expect(contain).toMatchObject({
      method: "POST",
      url: "https://api.eu-1.crowdstrike.com/devices/entities/devices-actions/v2?action_name=contain",
    });
    expect(JSON.parse(contain.body as string)).toEqual({ ids: ["dev1"] });
  });

  test("names the missing scope on a 403", async () => {
    const { client } = falcon(() => {
      return respond(403, { errors: [{ message: "access denied" }] });
    });

    await expect(client.containDevices(["dev1"])).rejects.toThrow(
      /Hosts: Write/,
    );
  });

  test("refuses a cloud it does not know", () => {
    expect(() => {
      return new CrowdStrikeFalconResponseClient({
        cloud: "mars-1",
        clientId: "c",
        clientSecret: "s",
        transport: async () => {
          return respond(200, {});
        },
      });
    }).toThrow(/mars-1/);
  });
});

describe("MicrosoftDefenderEndpointClient", () => {
  function defender(
    responder: Responder,
    cloud: string = "public",
  ): {
    client: MicrosoftDefenderEndpointClient;
    requests: Array<DataSourceHttpRequest>;
  } {
    const { requests, transport } = recording(
      (request: DataSourceHttpRequest) => {
        if (request.url.includes("/oauth2/v2.0/token")) {
          return respond(200, { access_token: "mde-token" });
        }

        return responder(request);
      },
    );

    return {
      client: new MicrosoftDefenderEndpointClient({
        tenantId: "contoso.onmicrosoft.com",
        clientId: "2f1c7a3e-0000-4000-8000-000000000001",
        clientSecret: "mde-secret",
        cloud,
        transport,
      }),
      requests,
    };
  }

  test("quotes an OData string by doubling its quotes", () => {
    expect(odataQuotedValue("o'brien-pc")).toBe("'o''brien-pc'");
  });

  test("asks for a token for the Defender API and finds the host's devices", async () => {
    const { client, requests } = defender(() => {
      return respond(200, {
        value: [
          { id: "m1", computerDnsName: "web-01.contoso.com" },
          { id: "m2", computerDnsName: "WEB-01" },
          { id: "m3", computerDnsName: "web-010.contoso.com" },
        ],
      });
    });

    const machines: Array<DefenderMachine> =
      await client.findMachines("web-01");

    expect(
      machines.map((machine: DefenderMachine) => {
        return machine.id;
      }),
    ).toEqual(["m1", "m2"]);

    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token",
    });
    expect((requests[0]!.body as Record<string, string>)["scope"]).toBe(
      "https://api.securitycenter.microsoft.com/.default",
    );

    const lookup: URL = new URL(requests[1]!.url);

    expect(lookup.origin + lookup.pathname).toBe(
      "https://api.security.microsoft.com/api/machines",
    );
    expect(lookup.searchParams.get("$filter")).toBe(
      "startswith(computerDnsName,'web-01')",
    );
  });

  test("reads Defender's 404 as no device", async () => {
    const { client } = defender(() => {
      return respond(404, { error: { code: "ResourceNotFound" } });
    });

    expect(await client.findMachines("ghost")).toEqual([]);
  });

  test("isolates with a comment and the chosen isolation type", async () => {
    const { client, requests } = defender(() => {
      return respond(201, { id: "action-1" });
    });

    await client.isolateMachine({
      machineId: "m1",
      isolationType: "Selective",
      comment: "Isolated for CASE-7",
    });

    const isolate: DataSourceHttpRequest = requests[requests.length - 1]!;

    expect(isolate).toMatchObject({
      method: "POST",
      url: "https://api.security.microsoft.com/api/machines/m1/isolate",
    });
    expect(JSON.parse(isolate.body as string)).toEqual({
      Comment: "Isolated for CASE-7",
      IsolationType: "Selective",
    });
  });

  test("uses the US Government endpoints for the usgov cloud", async () => {
    const { client, requests } = defender(() => {
      return respond(200, { value: [] });
    }, "usgov");

    await client.findMachines("web-01");

    expect(
      requests[0]!.url.startsWith("https://login.microsoftonline.us/"),
    ).toBe(true);
    expect(
      requests[1]!.url.startsWith(
        "https://api-gov.securitycenter.microsoft.us/",
      ),
    ).toBe(true);
  });

  test("names the missing permission on a 403", async () => {
    const { client } = defender(() => {
      return respond(403, { error: { code: "Forbidden" } });
    });

    await expect(
      client.isolateMachine({
        machineId: "m1",
        isolationType: "Full",
        comment: "c",
      }),
    ).rejects.toThrow(/Machine\.Isolate/);
  });
});
