import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { SecurityConnectorSettings } from "../../../../Server/Utils/SecurityEvent/Connectors/Types";
import SecurityPlaybookContainment, {
  ProductContainment,
  ProductContainmentHow,
  ProductContainmentReading,
  getOktaUserUrl,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { describe, expect, test } from "@jest/globals";

/*
 * Where an account or a host stands in the product, read back - never acted
 * on - for a Response Plan step's check (#10340): an admin who suspended
 * the account in Okta's own console, or contained the host in Falcon's, is
 * seen exactly as a playbook's run is. Each product is a mock of its API
 * that answers GETs only: a read-back that tried to change anything fails.
 */

const OKTA_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.OktaSystemLog,
  config: { orgUrl: "https://acme.okta.com" },
  secrets: { apiToken: "00okta-token" },
  alertingOnly: false,
};

const ENTRA_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.MicrosoftEntraId,
  config: {
    tenantId: "contoso.onmicrosoft.com",
    clientId: "2f1c7a3e-0000-4000-8000-000000000001",
    cloud: "public",
  },
  secrets: { clientSecret: "s" },
  alertingOnly: false,
};

const FALCON_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
  config: { clientId: "c", cloud: "us-1" },
  secrets: { clientSecret: "s" },
  alertingOnly: true,
};

const DEFENDER_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
  config: {
    tenantId: "contoso.onmicrosoft.com",
    clientId: "2f1c7a3e-0000-4000-8000-000000000001",
    cloud: "public",
  },
  secrets: { clientSecret: "s" },
  alertingOnly: true,
};

function respond(statusCode: number, body: unknown): DataSourceHttpResponse {
  return { statusCode, bodyText: JSON.stringify(body ?? ""), bodyJson: body };
}

type Transport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

// A product that answers reads, and fails anything that would change it.
function readOnly(
  answer: (url: URL) => DataSourceHttpResponse,
  requests: Array<DataSourceHttpRequest> = [],
): Transport {
  return async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    requests.push(request);

    if (request.url.includes("oauth2")) {
      return respond(200, { access_token: "token" });
    }

    if (request.method !== "GET") {
      throw new Error(`a read-back must not ${request.method} ${request.url}`);
    }

    return answer(new URL(request.url));
  };
}

async function read(
  settings: SecurityConnectorSettings,
  value: string,
  transport: Transport,
): Promise<ProductContainmentReading> {
  return await SecurityPlaybookContainment.readState({
    provider: settings.provider,
    settings,
    value,
    transport,
  });
}

describe("an account in Okta", () => {
  function okta(
    users: Record<string, { status: string; statusChanged?: string }>,
  ): Transport {
    return readOnly((url: URL): DataSourceHttpResponse => {
      const login: string = decodeURIComponent(
        url.pathname.split("/").filter(Boolean)[3] || "",
      );
      const user: { status: string; statusChanged?: string } | undefined =
        users[login];

      return user
        ? respond(200, {
            id: "00u1",
            status: user.status,
            statusChanged: user.statusChanged,
            profile: { login },
          })
        : respond(404, { errorCode: "E0000007" });
    });
  }

  test("suspended by an admin in Okta: contained, since Okta's statusChanged, with the admin console's page", async () => {
    expect(
      await read(
        OKTA_SETTINGS,
        "alice@acme.com",
        okta({
          "alice@acme.com": {
            status: "SUSPENDED",
            statusChanged: "2026-11-17T19:12:00.000Z",
          },
        }),
      ),
    ).toEqual({
      provider: "Okta",
      containment: ProductContainment.Contained,
      how: ProductContainmentHow.Suspended,
      since: new Date("2026-11-17T19:12:00.000Z"),
      url: "https://acme-admin.okta.com/admin/user/profile/view/00u1",
    });
  });

  test("active is not contained; an account Okta does not have is not found", async () => {
    const transport: Transport = okta({
      "alice@acme.com": { status: "ACTIVE" },
    });

    expect(
      (await read(OKTA_SETTINGS, "alice@acme.com", transport)).containment,
    ).toBe(ProductContainment.NotContained);
    expect(
      (await read(OKTA_SETTINGS, "bob@acme.com", transport)).containment,
    ).toBe(ProductContainment.NotFound);
  });

  test("an org on its own domain has no admin page OneUptime can name", () => {
    expect(getOktaUserUrl("https://login.acme.com", "00u1")).toBeUndefined();
    expect(getOktaUserUrl("https://acme.oktapreview.com", "00u1")).toBe(
      "https://acme-admin.oktapreview.com/admin/user/profile/view/00u1",
    );
  });
});

describe("an account in Microsoft Entra ID", () => {
  function entra(account: {
    accountEnabled: boolean;
    validFrom: string | null;
  }): Transport {
    return readOnly((url: URL): DataSourceHttpResponse => {
      if (
        url.searchParams.get("$select") === "signInSessionsValidFromDateTime"
      ) {
        return respond(200, {
          signInSessionsValidFromDateTime: account.validFrom,
        });
      }

      return respond(200, {
        id: "11111111-aaaa-4aaa-8aaa-000000000001",
        userPrincipalName: "alice@contoso.com",
        accountEnabled: account.accountEnabled,
      });
    });
  }

  test("disabled: contained, with when its sessions were last ended", async () => {
    const reading: ProductContainmentReading = await read(
      ENTRA_SETTINGS,
      "alice@contoso.com",
      entra({ accountEnabled: false, validFrom: "2026-11-17T19:15:00Z" }),
    );

    expect(reading).toMatchObject({
      provider: "Microsoft Entra ID",
      containment: ProductContainment.Contained,
      how: ProductContainmentHow.Disabled,
      sessionsEndedAt: new Date("2026-11-17T19:15:00Z"),
    });
    expect(reading.url).toContain("entra.microsoft.com");
  });

  test("enabled: not contained", async () => {
    expect(
      (
        await read(
          ENTRA_SETTINGS,
          "alice@contoso.com",
          entra({ accountEnabled: true, validFrom: null }),
        )
      ).containment,
    ).toBe(ProductContainment.NotContained);
  });
});

describe("a host in CrowdStrike Falcon", () => {
  function falcon(statuses: Record<string, string>): Transport {
    return readOnly((url: URL): DataSourceHttpResponse => {
      if (url.pathname.endsWith("/devices/queries/devices/v1")) {
        return respond(200, { resources: Object.keys(statuses) });
      }

      return respond(200, {
        resources: url.searchParams.getAll("ids").map((id: string) => {
          return { device_id: id, status: statuses[id] };
        }),
      });
    });
  }

  test("every device with the hostname contained: network-contained, with the host's page in the console", async () => {
    expect(
      await read(FALCON_SETTINGS, "web-01", falcon({ d1: "contained" })),
    ).toEqual({
      provider: "CrowdStrike Falcon",
      containment: ProductContainment.Contained,
      how: ProductContainmentHow.NetworkContained,
      since: null,
      url: "https://falcon.crowdstrike.com/hosts/hosts/host/d1",
    });
  });

  test("one device left out is a way in: not contained; one on its way: pending", async () => {
    expect(
      (
        await read(
          FALCON_SETTINGS,
          "web-01",
          falcon({ d1: "contained", d2: "normal" }),
        )
      ).containment,
    ).toBe(ProductContainment.NotContained);
    expect(
      (
        await read(
          FALCON_SETTINGS,
          "web-01",
          falcon({ d1: "containment_pending" }),
        )
      ).containment,
    ).toBe(ProductContainment.Pending);
    expect(
      (await read(FALCON_SETTINGS, "web-01", falcon({}))).containment,
    ).toBe(ProductContainment.NotFound);
  });
});

describe("a host in Microsoft Defender", () => {
  function defender(
    actions: Array<{ type: string; status: string; at: string }>,
  ): Transport {
    return readOnly((url: URL): DataSourceHttpResponse => {
      if (url.pathname.endsWith("/api/machines")) {
        return respond(200, {
          value: [{ id: "m1", computerDnsName: "web-01.contoso.com" }],
        });
      }

      return respond(200, {
        value: actions.map(
          (action: { type: string; status: string; at: string }) => {
            return {
              type: action.type,
              status: action.status,
              lastUpdateDateTimeUtc: action.at,
            };
          },
        ),
      });
    });
  }

  test("isolated by its latest isolation action that succeeded, since then", async () => {
    expect(
      await read(
        DEFENDER_SETTINGS,
        "web-01",
        defender([
          { type: "Isolate", status: "Succeeded", at: "2026-11-17T19:20:00Z" },
          { type: "Unisolate", status: "Failed", at: "2026-11-17T19:30:00Z" },
        ]),
      ),
    ).toEqual({
      provider: "Microsoft Defender",
      containment: ProductContainment.Contained,
      how: ProductContainmentHow.Isolated,
      since: new Date("2026-11-17T19:20:00Z"),
      url: "https://security.microsoft.com/machines/m1",
    });
  });

  test("released after it was isolated: not contained", async () => {
    expect(
      (
        await read(
          DEFENDER_SETTINGS,
          "web-01",
          defender([
            {
              type: "Isolate",
              status: "Succeeded",
              at: "2026-11-17T19:20:00Z",
            },
            {
              type: "Unisolate",
              status: "Succeeded",
              at: "2026-11-17T19:40:00Z",
            },
          ]),
        )
      ).containment,
    ).toBe(ProductContainment.NotContained);
  });
});

describe("a product that cannot be read", () => {
  test("throws, so the step says it could not check rather than that the account is active", async () => {
    await expect(
      read(
        OKTA_SETTINGS,
        "alice@acme.com",
        readOnly((): DataSourceHttpResponse => {
          return respond(403, { errorSummary: "You do not have permission" });
        }),
      ),
    ).rejects.toThrow();
  });

  test("a product OneUptime cannot read accounts in is no answer either", async () => {
    await expect(
      SecurityPlaybookContainment.readState({
        provider: SecurityEventConnectorProvider.GoogleSecOps,
        settings: {
          ...OKTA_SETTINGS,
          provider: SecurityEventConnectorProvider.GoogleSecOps,
        },
        value: "alice@acme.com",
        transport: readOnly((): DataSourceHttpResponse => {
          return respond(200, {});
        }),
      }),
    ).rejects.toThrow();
  });
});
