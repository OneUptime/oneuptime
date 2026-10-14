import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { SecurityConnectorSettings } from "../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { PlaybookStepOutcome } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookContainment, {
  CONTAINMENT_ENTITY_LIMIT,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { DefenderIsolationType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { describe, expect, test } from "@jest/globals";

/*
 * What a containment step reports, for every way an entity can turn out:
 * done, already done, not in the product, refused. "Succeeded" must mean the
 * accounts are suspended and the hosts contained - an analyst acts on it.
 */

function connection(
  provider: SecurityEventConnectorProvider,
): SecurityEventConnection {
  const model: SecurityEventConnection = new SecurityEventConnection();
  model.name = "Primary";
  model.provider = provider;
  return model;
}

const OKTA_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.OktaSystemLog,
  config: { orgUrl: "https://acme.okta.com" },
  secrets: { apiToken: "00okta-token" },
  alertingOnly: false,
};

function respond(statusCode: number, body: unknown): DataSourceHttpResponse {
  return { statusCode, bodyText: JSON.stringify(body ?? ""), bodyJson: body };
}

interface RecordingTransport {
  requests: Array<DataSourceHttpRequest>;
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>;
}

function oktaTransport(
  users: Record<string, string>,
  failSuspend: Array<string> = [],
): RecordingTransport {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      const url: URL = new URL(request.url);
      const parts: Array<string> = url.pathname.split("/").filter(Boolean);

      if (request.method === "GET") {
        const login: string = decodeURIComponent(parts[3] || "");
        const status: string | undefined = users[login];

        return status
          ? respond(200, { id: `id-${login}`, status, profile: { login } })
          : respond(404, { errorCode: "E0000007" });
      }

      const userId: string = decodeURIComponent(parts[3] || "");

      if (failSuspend.includes(userId)) {
        return respond(403, { errorSummary: "You do not have permission" });
      }

      return respond(200, {});
    },
  };
}

function users(...values: Array<string>): Array<SecurityEntity> {
  return values.map((value: string): SecurityEntity => {
    return { type: SecurityEntityType.User, value };
  });
}

describe("SecurityPlaybookContainment", () => {
  test("suspends each user of the case and says so", async () => {
    const { requests, transport } = oktaTransport({
      "alice@acme.com": "ACTIVE",
      "bob@acme.com": "SUSPENDED",
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendOktaUser,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      entities: [
        ...users("alice@acme.com", "bob@acme.com"),
        { type: SecurityEntityType.Host, value: "web-01" },
      ],
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toContain("`alice@acme.com`");
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`bob@acme.com`: already suspended",
    );
    // Hosts are not users: nothing was asked about web-01.
    expect(
      requests.some((request: DataSourceHttpRequest) => {
        return request.url.includes("web-01");
      }),
    ).toBe(false);
    // Bob was already suspended: no second suspend.
    expect(
      requests.filter((request: DataSourceHttpRequest) => {
        return request.method === "POST";
      }),
    ).toHaveLength(1);
  });

  test("fails when a user could not be suspended, naming them", async () => {
    const { transport } = oktaTransport(
      { "alice@acme.com": "ACTIVE", "carol@acme.com": "ACTIVE" },
      ["id-carol@acme.com"],
    );

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendOktaUser,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      entities: users("alice@acme.com", "carol@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.summary.toString()).toContain("1 could not be");
    expect(outcome.error).toContain("carol@acme.com");
  });

  test("fails when none of the users is in the product", async () => {
    const { transport } = oktaTransport({});

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.EndOktaSessions,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      entities: users("ghost@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toContain("ghost@acme.com: not found in Okta");
  });

  test("ends sessions with a DELETE for each user", async () => {
    const { requests, transport } = oktaTransport({
      "alice@acme.com": "ACTIVE",
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.EndOktaSessions,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      entities: users("alice@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "signed out everywhere",
    );
    expect(requests[1]!.method).toBe("DELETE");
  });

  test("skips when the case names nothing of the step's kind", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
      connection: connection(SecurityEventConnectorProvider.CrowdStrikeFalcon),
      settings: {
        provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
        config: { clientId: "c", cloud: "us-1" },
        secrets: { clientSecret: "s" },
        alertingOnly: true,
      },
      entities: users("alice@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport: async () => {
        throw new Error("no request should be made");
      },
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toContain("no host");
  });

  test("refuses a connection to another product", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendOktaUser,
      connection: connection(SecurityEventConnectorProvider.CrowdStrikeFalcon),
      settings: OKTA_SETTINGS,
      entities: users("alice@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toContain("not a connection to the product");
  });

  test("acts on at most the entity limit", async () => {
    const { requests, transport } = oktaTransport(
      Object.fromEntries(
        Array.from(
          { length: CONTAINMENT_ENTITY_LIMIT + 5 },
          (_value: unknown, index: number) => {
            return [`user${index}@acme.com`, "ACTIVE"];
          },
        ),
      ),
    );

    await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendOktaUser,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      entities: users(
        ...Array.from(
          { length: CONTAINMENT_ENTITY_LIMIT + 5 },
          (_value: unknown, index: number) => {
            return `user${index}@acme.com`;
          },
        ),
      ),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(
      requests.filter((request: DataSourceHttpRequest) => {
        return request.method === "POST";
      }),
    ).toHaveLength(CONTAINMENT_ENTITY_LIMIT);
  });

  test("isolates every Defender device of a host, with the case in the comment", async () => {
    const requests: Array<DataSourceHttpRequest> = [];

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.IsolateDefenderDevice,
      connection: connection(
        SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      ),
      settings: {
        provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
        config: {
          tenantId: "contoso.onmicrosoft.com",
          clientId: "2f1c7a3e-0000-4000-8000-000000000001",
          cloud: "public",
        },
        secrets: { clientSecret: "s" },
        alertingOnly: true,
      },
      entities: [{ type: SecurityEntityType.Host, value: "web-01" }],
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Selective,
      transport: async (request: DataSourceHttpRequest) => {
        requests.push(request);

        if (request.url.includes("oauth2")) {
          return respond(200, { access_token: "t" });
        }

        if (request.method === "GET") {
          return respond(200, {
            value: [
              { id: "m1", computerDnsName: "web-01.contoso.com" },
              { id: "m2", computerDnsName: "web-01" },
            ],
          });
        }

        return respond(201, { id: "action" });
      },
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);

    const isolations: Array<DataSourceHttpRequest> = requests.filter(
      (request: DataSourceHttpRequest) => {
        return request.url.endsWith("/isolate");
      },
    );

    expect(isolations).toHaveLength(2);
    expect(JSON.parse(isolations[0]!.body as string)).toEqual({
      Comment: "Isolated by a OneUptime playbook for security case CASE-7.",
      IsolationType: "Selective",
    });
  });
});
