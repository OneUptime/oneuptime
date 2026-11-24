import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHICH MICROSOFT 365 ORGANIZATION A PROJECT IS CONNECTED TO, BY NAME
 * (Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsOrganization).
 *
 * Admin consent reads Microsoft Graph's /organization with the admin's own
 * token, and keeps the organization's display name and domain, so the
 * settings page can say which organization everybody signs in to. Every
 * Microsoft 365 developer tenant is called "Contoso": the domain is what
 * tells two of them apart (Teams store certification, ticket 5877223). The
 * read is best effort and never throws.
 */

const environment: Record<string, string | null> = {
  MicrosoftTeamsCloudSetting: null,
};

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return new Proxy(actual, {
    get: (target: Record<string, unknown>, key: string | symbol): unknown => {
      if (typeof key === "string" && key in environment) {
        return environment[key];
      }

      return target[key as string];
    },
  });
});

jest.mock("../../../../../Server/Utils/Logger");

import MicrosoftTeamsOrganization from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsOrganization";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import API from "../../../../../Utils/API";

const TENANT: string = "1c0f7a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_TENANT: string = "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918";

// Graph's answer to GET /organization: one organization, the token's.
function answer(organization: JSONObject): JSONObject {
  return { value: [organization] };
}

describe("readOrganization: what an answer to GET /organization says of the tenant", () => {
  test("its display name and its default domain", () => {
    expect(
      MicrosoftTeamsOrganization.readOrganization({
        answer: answer({
          id: TENANT,
          displayName: "Contoso",
          verifiedDomains: [
            {
              name: "m365x11111111.onmicrosoft.com",
              isDefault: false,
              isInitial: true,
            },
            { name: "contoso.com", isDefault: true, isInitial: false },
          ],
        }),
        tenantId: TENANT,
      }),
    ).toEqual({ name: "Contoso", domain: "contoso.com" });
  });

  test("with no default domain, the initial one every tenant has", () => {
    expect(
      MicrosoftTeamsOrganization.readOrganization({
        answer: answer({
          id: TENANT,
          displayName: "Contoso",
          verifiedDomains: [
            { name: "contoso.com", isDefault: false, isInitial: false },
            {
              name: "m365x11111111.onmicrosoft.com",
              isDefault: false,
              isInitial: true,
            },
          ],
        }),
        tenantId: TENANT,
      }),
    ).toEqual({ name: "Contoso", domain: "m365x11111111.onmicrosoft.com" });
  });

  test("with neither, the first domain; in lower case and trimmed", () => {
    expect(
      MicrosoftTeamsOrganization.readOrganization({
        answer: answer({
          id: TENANT,
          displayName: "  Contoso  ",
          verifiedDomains: [{ name: " Contoso.COM " }],
        }),
        tenantId: TENANT,
      }),
    ).toEqual({ name: "Contoso", domain: "contoso.com" });
  });

  test("the tenant id is matched whatever its case", () => {
    expect(
      MicrosoftTeamsOrganization.readOrganization({
        answer: answer({ id: TENANT.toUpperCase(), displayName: "Contoso" }),
        tenantId: TENANT,
      }),
    ).toEqual({ name: "Contoso" });
  });

  test("a name alone, or a domain alone, is kept alone", () => {
    expect(
      MicrosoftTeamsOrganization.readOrganization({
        answer: answer({ id: TENANT, displayName: "Contoso" }),
        tenantId: TENANT,
      }),
    ).toEqual({ name: "Contoso" });

    expect(
      MicrosoftTeamsOrganization.readOrganization({
        answer: answer({
          id: TENANT,
          displayName: "   ",
          verifiedDomains: [
            {
              name: "m365x11111111.onmicrosoft.com",
              isDefault: true,
              isInitial: true,
            },
          ],
        }),
        tenantId: TENANT,
      }),
    ).toEqual({ domain: "m365x11111111.onmicrosoft.com" });
  });

  test("an answer about another tenant is not taken", () => {
    expect(
      MicrosoftTeamsOrganization.readOrganization({
        answer: answer({ id: OTHER_TENANT, displayName: "Fabrikam" }),
        tenantId: TENANT,
      }),
    ).toBeNull();
  });

  test("an organization that names nothing, and answers that are not Graph's, are nothing", () => {
    const answers: Array<unknown> = [
      answer({ id: TENANT }),
      answer({ id: TENANT, displayName: 42, verifiedDomains: "contoso.com" }),
      { value: [] },
      { value: "Contoso" },
      { error: { code: "Authorization_RequestDenied" } },
      {},
      null,
      undefined,
      "Contoso",
    ];

    for (const value of answers) {
      expect(
        MicrosoftTeamsOrganization.readOrganization({
          answer: value,
          tenantId: TENANT,
        }),
      ).toBeNull();
    }
  });

  test("a name loses its control characters and is kept to 256 characters", () => {
    const read: { name?: string | undefined } | null =
      MicrosoftTeamsOrganization.readOrganization({
        answer: answer({
          id: TENANT,
          displayName: `Contoso\u0000\nLtd ${"x".repeat(400)}`,
        }),
        tenantId: TENANT,
      });

    expect(read?.name?.startsWith("Contoso  Ltd x")).toBe(true);
    expect(read?.name).toHaveLength(256);
    expect(read?.name).not.toContain("\u0000");
    expect(read?.name).not.toContain("\n");
  });

  test("a domain that is not a domain name is never kept", () => {
    const notDomains: Array<string> = [
      "contoso",
      "contoso.com/path",
      "https://contoso.com",
      "contoso .com",
      "<b>contoso</b>.com",
      `${"a".repeat(260)}.com`,
    ];

    for (const name of notDomains) {
      expect(
        MicrosoftTeamsOrganization.readOrganization({
          answer: answer({
            id: TENANT,
            displayName: "Contoso",
            verifiedDomains: [{ name: name, isDefault: true }],
          }),
          tenantId: TENANT,
        }),
      ).toEqual({ name: "Contoso" });
    }
  });
});

describe("read: GET /organization on this cloud's Graph, with the admin's token", () => {
  let get: SpyInstance<typeof API.get>;

  beforeEach(() => {
    environment["MicrosoftTeamsCloudSetting"] = null;
    get = jest.spyOn(API, "get") as unknown as SpyInstance<typeof API.get>;
  });

  afterEach(() => {
    environment["MicrosoftTeamsCloudSetting"] = null;
    jest.restoreAllMocks();
  });

  test("asks Graph for only what it keeps, with the token as a bearer, and reads the answer", async () => {
    get.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        answer({
          id: TENANT,
          displayName: "Contoso",
          verifiedDomains: [
            {
              name: "m365x11111111.onmicrosoft.com",
              isDefault: true,
              isInitial: true,
            },
          ],
        }),
        {},
      ) as never,
    );

    await expect(
      MicrosoftTeamsOrganization.read({
        accessToken: "admin-token",
        tenantId: TENANT,
      }),
    ).resolves.toEqual({
      name: "Contoso",
      domain: "m365x11111111.onmicrosoft.com",
    });

    expect(get).toHaveBeenCalledTimes(1);

    const request: { url: URL; headers?: Record<string, string> } = get.mock
      .calls[0]![0] as unknown as {
      url: URL;
      headers?: Record<string, string>;
    };

    expect(request.url.toString()).toBe(
      "https://graph.microsoft.com/v1.0/organization?$select=id,displayName,verifiedDomains",
    );
    expect(request.headers).toEqual({ Authorization: "Bearer admin-token" });
  });

  test("in GCC High, Azure Government's Graph", async () => {
    environment["MicrosoftTeamsCloudSetting"] = "gcc-high";
    get.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        answer({ id: TENANT, displayName: "Agency" }),
        {},
      ) as never,
    );

    await MicrosoftTeamsOrganization.read({
      accessToken: "admin-token",
      tenantId: TENANT,
    });

    expect(
      (get.mock.calls[0]![0] as unknown as { url: URL }).url.toString(),
    ).toBe(
      "https://graph.microsoft.us/v1.0/organization?$select=id,displayName,verifiedDomains",
    );
  });

  test("a refusal from Graph is nothing, not an error", async () => {
    get.mockResolvedValue(
      new HTTPErrorResponse(
        403,
        { error: { code: "Authorization_RequestDenied" } },
        {},
      ) as never,
    );

    await expect(
      MicrosoftTeamsOrganization.read({
        accessToken: "admin-token",
        tenantId: TENANT,
      }),
    ).resolves.toBeNull();
  });

  test("a request that throws is nothing, not an error", async () => {
    get.mockRejectedValue(new Error("socket hang up") as never);

    await expect(
      MicrosoftTeamsOrganization.read({
        accessToken: "admin-token",
        tenantId: TENANT,
      }),
    ).resolves.toBeNull();
  });

  test("a cloud setting that names no cloud sends nothing, and is nothing", async () => {
    environment["MicrosoftTeamsCloudSetting"] = "gcc high please";

    await expect(
      MicrosoftTeamsOrganization.read({
        accessToken: "admin-token",
        tenantId: TENANT,
      }),
    ).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
