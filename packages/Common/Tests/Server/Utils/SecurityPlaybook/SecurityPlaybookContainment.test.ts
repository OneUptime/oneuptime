import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { SecurityConnectorSettings } from "../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { PlaybookStepOutcome } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookContainment, {
  ContainmentTargetOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { DefenderIsolationType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import {
  FAKE_ADMIN_EMAIL,
  FAKE_SERVICE_ACCOUNT_JSON,
  FAKE_TOKEN_URI,
} from "../SecurityEvent/Connectors/GoogleWorkspace/GoogleWorkspaceFakeApi";
import { describe, expect, test } from "@jest/globals";

/*
 * What a containment step, and its undo, reports for every way a target can
 * turn out: done, already done, not in the product, refused - and protected
 * or left out by the approver, which never reach the product at all.
 * "Succeeded" must mean the accounts are suspended and the hosts contained:
 * an analyst acts on it. Each product is a recording mock of its API.
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

interface RecordingTransport {
  requests: Array<DataSourceHttpRequest>;
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>;
}

function oktaTransport(
  users: Record<string, string>,
  failUserIds: Array<string> = [],
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

      if (failUserIds.includes(userId)) {
        return respond(403, { errorSummary: "You do not have permission" });
      }

      return respond(200, {});
    },
  };
}

function falconTransport(
  devices: Record<string, Array<string>>,
): RecordingTransport {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      if (request.url.endsWith("/oauth2/token")) {
        return respond(201, { access_token: "falcon-token" });
      }

      if (request.method === "GET") {
        const filter: string =
          new URL(request.url).searchParams.get("filter") || "";
        const host: string = filter
          .replace(/^hostname:'/, "")
          .replace(/'$/, "");

        return respond(200, { resources: devices[host] || [] });
      }

      return respond(202, { resources: [] });
    },
  };
}

function defenderTransport(): RecordingTransport {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
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
  };
}

function targets(
  type: SecurityEntityType,
  ...values: Array<string>
): Array<SecurityPlaybookTarget> {
  return values.map((value: string): SecurityPlaybookTarget => {
    return {
      type,
      value,
      reason: SecurityPlaybookTargetReason.GroupedOn,
      state: SecurityPlaybookTargetState.Proposed,
    };
  });
}

function users(...values: Array<string>): Array<SecurityPlaybookTarget> {
  return targets(SecurityEntityType.User, ...values);
}

function hosts(...values: Array<string>): Array<SecurityPlaybookTarget> {
  return targets(SecurityEntityType.Host, ...values);
}

function posts(requests: Array<DataSourceHttpRequest>): Array<string> {
  return requests
    .filter((request: DataSourceHttpRequest): boolean => {
      return request.method === "POST" && !request.url.includes("oauth2");
    })
    .map((request: DataSourceHttpRequest): string => {
      return request.url;
    });
}

function stateOf(
  outcome: PlaybookStepOutcome,
  value: string,
): SecurityPlaybookTargetState | undefined {
  return outcome.targets?.find((target: SecurityPlaybookTarget): boolean => {
    return target.value === value;
  })?.state;
}

describe("SecurityPlaybookContainment.run", () => {
  test("suspends each target and says so, one by one", async () => {
    const { requests, transport } = oktaTransport({
      "alice@acme.com": "ACTIVE",
      "bob@acme.com": "SUSPENDED",
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendOktaUser,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      targets: users("alice@acme.com", "bob@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toContain("`alice@acme.com`");
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`bob@acme.com`: already suspended",
    );
    expect(stateOf(outcome, "alice@acme.com")).toBe(
      SecurityPlaybookTargetState.Done,
    );
    expect(stateOf(outcome, "bob@acme.com")).toBe(
      SecurityPlaybookTargetState.AlreadyDone,
    );
    // Bob was already suspended: no second suspend.
    expect(posts(requests)).toEqual([
      "https://acme.okta.com/api/v1/users/id-alice%40acme.com/lifecycle/suspend",
    ]);
  });

  test("never sends a protected target, or one the approver left out, to the product", async () => {
    const { requests, transport } = oktaTransport({
      "alice@acme.com": "ACTIVE",
      "breakglass@acme.com": "ACTIVE",
      "bob@acme.com": "ACTIVE",
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendOktaUser,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      targets: [
        ...users("alice@acme.com"),
        {
          ...users("breakglass@acme.com")[0]!,
          state: SecurityPlaybookTargetState.Protected,
          protectedBy: "breakglass@*",
        },
        {
          ...users("bob@acme.com")[0]!,
          state: SecurityPlaybookTargetState.LeftOut,
        },
      ],
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(
      requests.some((request: DataSourceHttpRequest): boolean => {
        return (
          request.url.includes("breakglass") || request.url.includes("bob")
        );
      }),
    ).toBe(false);
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`breakglass@acme.com`: protected (matches breakglass@\\*)",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`bob@acme.com`: left out by the approver",
    );
    expect(stateOf(outcome, "breakglass@acme.com")).toBe(
      SecurityPlaybookTargetState.Protected,
    );
  });

  test("skips, saying why, when every target is protected", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
      connection: connection(SecurityEventConnectorProvider.CrowdStrikeFalcon),
      settings: FALCON_SETTINGS,
      targets: [
        {
          ...hosts("vpn-gw-01")[0]!,
          state: SecurityPlaybookTargetState.Protected,
          protectedBy: "vpn-gw-01",
        },
      ],
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport: async () => {
        throw new Error("no request should be made");
      },
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe(
      "No host to act on: `vpn-gw-01` is protected.",
    );
  });

  test("skips when there is no target at all", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
      connection: connection(SecurityEventConnectorProvider.CrowdStrikeFalcon),
      settings: FALCON_SETTINGS,
      targets: [],
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport: async () => {
        throw new Error("no request should be made");
      },
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toContain(
      "no detection of the case is grouped on a host",
    );
  });

  test("fails when a target could not be suspended, naming it", async () => {
    const { transport } = oktaTransport(
      { "alice@acme.com": "ACTIVE", "carol@acme.com": "ACTIVE" },
      ["id-carol@acme.com"],
    );

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendOktaUser,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      targets: users("alice@acme.com", "carol@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.summary.toString()).toContain("1 could not be");
    expect(outcome.error).toContain("carol@acme.com");
    expect(stateOf(outcome, "carol@acme.com")).toBe(
      SecurityPlaybookTargetState.Failed,
    );
  });

  test("fails when none of the targets is in the product", async () => {
    const { transport } = oktaTransport({});

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.EndOktaSessions,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      targets: users("ghost@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toContain("ghost@acme.com: not found in Okta");
    expect(stateOf(outcome, "ghost@acme.com")).toBe(
      SecurityPlaybookTargetState.NotFound,
    );
  });

  test("ends sessions with a DELETE for each target", async () => {
    const { requests, transport } = oktaTransport({
      "alice@acme.com": "ACTIVE",
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.EndOktaSessions,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      targets: users("alice@acme.com"),
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

  test("refuses a connection to another product", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendOktaUser,
      connection: connection(SecurityEventConnectorProvider.CrowdStrikeFalcon),
      settings: OKTA_SETTINGS,
      targets: users("alice@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toContain("not a connection to the product");
  });

  test("contains every Falcon device of a host", async () => {
    const { requests, transport } = falconTransport({
      "web-01": ["d1", "d2"],
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
      connection: connection(SecurityEventConnectorProvider.CrowdStrikeFalcon),
      settings: FALCON_SETTINGS,
      targets: hosts("web-01"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(posts(requests)).toEqual([
      "https://api.crowdstrike.com/devices/entities/devices-actions/v2?action_name=contain",
    ]);
    expect(
      JSON.parse(
        requests.find((request: DataSourceHttpRequest): boolean => {
          return request.url.includes("action_name");
        })!.body as string,
      ),
    ).toEqual({ ids: ["d1", "d2"] });
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "contained (2 devices with this hostname)",
    );
  });

  test("isolates every Defender device of a host, with the case in the comment", async () => {
    const { requests, transport } = defenderTransport();

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.IsolateDefenderDevice,
      connection: connection(
        SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      ),
      settings: DEFENDER_SETTINGS,
      targets: hosts("web-01"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Selective,
      transport,
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

describe("the undo steps", () => {
  test("Unsuspend the user in Okta unsuspends a suspended user, and leaves an active one alone", async () => {
    const { requests, transport } = oktaTransport({
      "alice@acme.com": "SUSPENDED",
      "bob@acme.com": "ACTIVE",
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.UnsuspendOktaUser,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      targets: users("alice@acme.com", "bob@acme.com"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(posts(requests)).toEqual([
      "https://acme.okta.com/api/v1/users/id-alice%40acme.com/lifecycle/unsuspend",
    ]);
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`alice@acme.com`: unsuspended",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`bob@acme.com`: not suspended",
    );
    expect(outcome.summary.toString()).toContain("Unsuspend the user in Okta");
  });

  test("Lift containment in CrowdStrike lifts it from every device of the host", async () => {
    const { requests, transport } = falconTransport({ "web-01": ["d1"] });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.LiftCrowdStrikeContainment,
      connection: connection(SecurityEventConnectorProvider.CrowdStrikeFalcon),
      settings: FALCON_SETTINGS,
      targets: hosts("web-01"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(posts(requests)).toEqual([
      "https://api.crowdstrike.com/devices/entities/devices-actions/v2?action_name=lift_containment",
    ]);
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`web-01`: containment lifted",
    );
  });

  test("Release the device in Microsoft Defender releases every device of the host", async () => {
    const { requests, transport } = defenderTransport();

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.ReleaseDefenderDevice,
      connection: connection(
        SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      ),
      settings: DEFENDER_SETTINGS,
      targets: hosts("web-01"),
      caseNumber: "CASE-7",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);

    const releases: Array<DataSourceHttpRequest> = requests.filter(
      (request: DataSourceHttpRequest) => {
        return request.url.endsWith("/unisolate");
      },
    );

    expect(releases).toHaveLength(2);
    expect(JSON.parse(releases[0]!.body as string)).toEqual({
      Comment: "Released by OneUptime for security case CASE-7.",
    });
  });
});

describe("SecurityPlaybookContainment.undo, the one-click on a contained target", () => {
  test("undoes a suspension with Okta's unsuspend", async () => {
    const { requests, transport } = oktaTransport({
      "alice@acme.com": "SUSPENDED",
    });

    const outcome: ContainmentTargetOutcome =
      await SecurityPlaybookContainment.undo({
        action: SecurityPlaybookActionType.SuspendOktaUser,
        connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
        settings: OKTA_SETTINGS,
        value: "alice@acme.com",
        caseNumber: "CASE-7",
        transport,
      });

    expect(outcome).toEqual({
      state: SecurityPlaybookTargetState.Done,
      detail: "unsuspended",
    });
    expect(posts(requests)).toEqual([
      "https://acme.okta.com/api/v1/users/id-alice%40acme.com/lifecycle/unsuspend",
    ]);
  });

  test("undoes a CrowdStrike containment by lifting it", async () => {
    const { requests, transport } = falconTransport({ "web-01": ["d1"] });

    const outcome: ContainmentTargetOutcome =
      await SecurityPlaybookContainment.undo({
        action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
        connection: connection(
          SecurityEventConnectorProvider.CrowdStrikeFalcon,
        ),
        settings: FALCON_SETTINGS,
        value: "web-01",
        caseNumber: "CASE-7",
        transport,
      });

    expect(outcome.state).toBe(SecurityPlaybookTargetState.Done);
    expect(posts(requests)).toEqual([
      "https://api.crowdstrike.com/devices/entities/devices-actions/v2?action_name=lift_containment",
    ]);
  });

  test("undoes a Defender isolation by releasing the device", async () => {
    const { requests, transport } = defenderTransport();

    const outcome: ContainmentTargetOutcome =
      await SecurityPlaybookContainment.undo({
        action: SecurityPlaybookActionType.IsolateDefenderDevice,
        connection: connection(
          SecurityEventConnectorProvider.MicrosoftDefenderXdr,
        ),
        settings: DEFENDER_SETTINGS,
        value: "web-01",
        caseNumber: "CASE-7",
        transport,
      });

    expect(outcome).toEqual({
      state: SecurityPlaybookTargetState.Done,
      detail: "released from isolation",
    });
    expect(
      requests.filter((request: DataSourceHttpRequest): boolean => {
        return request.url.endsWith("/unisolate");
      }),
    ).toHaveLength(2);
  });

  test("says when the product refuses", async () => {
    const { transport } = oktaTransport({ "alice@acme.com": "SUSPENDED" }, [
      "id-alice@acme.com",
    ]);

    const outcome: ContainmentTargetOutcome =
      await SecurityPlaybookContainment.undo({
        action: SecurityPlaybookActionType.SuspendOktaUser,
        connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
        settings: OKTA_SETTINGS,
        value: "alice@acme.com",
        caseNumber: "CASE-7",
        transport,
      });

    expect(outcome.state).toBe(SecurityPlaybookTargetState.Failed);
    expect(outcome.detail).toContain("cannot unsuspend this user");
  });

  test("has nothing to undo an ended session with", async () => {
    await expect(
      SecurityPlaybookContainment.undo({
        action: SecurityPlaybookActionType.EndOktaSessions,
        connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
        settings: OKTA_SETTINGS,
        value: "alice@acme.com",
        caseNumber: "CASE-7",
        transport: async () => {
          throw new Error("no request should be made");
        },
      }),
    ).rejects.toThrow(/Nothing undoes/);
  });
});

/*
 * The identity products connected since the connections for them: Microsoft
 * Entra ID (Graph) and Google Workspace (the Directory API), through the
 * same settings their connections read logs with.
 */
const ENTRA_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.MicrosoftEntraId,
  config: {
    tenantId: "contoso.onmicrosoft.com",
    clientId: "2f1c7a3e-0000-4000-8000-000000000001",
    cloud: "public",
  },
  secrets: { clientSecret: "entra-secret" },
  alertingOnly: false,
};

const WORKSPACE_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.GoogleWorkspace,
  config: { adminEmail: FAKE_ADMIN_EMAIL },
  secrets: { serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON },
  alertingOnly: false,
};

// Entra ID accounts by sign-in name: whether each is enabled.
function entraTransport(
  accounts: Record<string, boolean>,
  refuseIds: Array<string> = [],
): RecordingTransport {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      const url: URL = new URL(request.url);

      if (url.pathname.endsWith("/oauth2/v2.0/token")) {
        return respond(200, { access_token: "graph-token", expires_in: 3599 });
      }

      if (request.method === "GET" && url.pathname === "/v1.0/users") {
        return respond(200, { value: [] });
      }

      const name: string = decodeURIComponent(
        url.pathname.replace("/v1.0/users/", "").split("/")[0] || "",
      );

      if (request.method === "GET") {
        return name in accounts
          ? respond(200, {
              id: `id-${name}`,
              userPrincipalName: name,
              accountEnabled: accounts[name],
            })
          : respond(404, { error: { code: "Request_ResourceNotFound" } });
      }

      if (refuseIds.includes(name)) {
        return respond(403, {
          error: {
            code: "Authorization_RequestDenied",
            message: "Insufficient privileges to complete the operation.",
          },
        });
      }

      return request.method === "PATCH"
        ? respond(204, undefined)
        : respond(200, { value: true });
    },
  };
}

// Workspace users by primary email: whether each is suspended.
function workspaceTransport(
  accounts: Record<string, boolean>,
): RecordingTransport {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      if (request.url === FAKE_TOKEN_URI) {
        return respond(200, { access_token: "ya29.token", expires_in: 3599 });
      }

      const key: string = decodeURIComponent(
        new URL(request.url).pathname
          .replace("/admin/directory/v1/users/", "")
          .split("/")[0] || "",
      );

      if (request.method === "GET") {
        return key in accounts
          ? respond(200, {
              id: `id-${key}`,
              primaryEmail: key,
              suspended: accounts[key],
            })
          : respond(404, { error: { code: 404 } });
      }

      return respond(200, {});
    },
  };
}

function writes(requests: Array<DataSourceHttpRequest>): Array<string> {
  return requests
    .filter((request: DataSourceHttpRequest): boolean => {
      return (
        request.method !== "GET" &&
        !request.url.endsWith("/oauth2/v2.0/token") &&
        request.url !== FAKE_TOKEN_URI
      );
    })
    .map((request: DataSourceHttpRequest): string => {
      return `${request.method} ${request.url}${request.body ? ` ${String(request.body)}` : ""}`;
    });
}

describe("containment in Microsoft Entra ID", () => {
  test("disables each enabled account, says which were disabled already, and which Entra ID does not know", async () => {
    const { requests, transport } = entraTransport({
      "alice@contoso.com": true,
      "bob@contoso.com": false,
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.DisableEntraIdUser,
      connection: connection(SecurityEventConnectorProvider.MicrosoftEntraId),
      settings: ENTRA_SETTINGS,
      targets: users("alice@contoso.com", "bob@contoso.com", "ghost"),
      caseNumber: "CASE-9",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(stateOf(outcome, "alice@contoso.com")).toBe(
      SecurityPlaybookTargetState.Done,
    );
    expect(stateOf(outcome, "bob@contoso.com")).toBe(
      SecurityPlaybookTargetState.AlreadyDone,
    );
    expect(stateOf(outcome, "ghost")).toBe(
      SecurityPlaybookTargetState.NotFound,
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`ghost`: not found in Microsoft Entra ID",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`bob@contoso.com`: already disabled",
    );
    expect(writes(requests)).toEqual([
      'PATCH https://graph.microsoft.com/v1.0/users/id-alice%40contoso.com {"accountEnabled":false}',
    ]);
    // It acted on everything Entra ID knows, and its details name the one it does not.
    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toContain(
      "Disable the user in Microsoft Entra ID: done for `alice@contoso.com`, `bob@contoso.com`",
    );
  });

  test("signs each target out, and fails naming the one Graph refused", async () => {
    const { requests, transport } = entraTransport(
      { "alice@contoso.com": true, "admin@contoso.com": true },
      ["id-admin@contoso.com"],
    );

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SignOutEntraIdUser,
      connection: connection(SecurityEventConnectorProvider.MicrosoftEntraId),
      settings: ENTRA_SETTINGS,
      targets: users("alice@contoso.com", "admin@contoso.com"),
      caseNumber: "CASE-9",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(stateOf(outcome, "alice@contoso.com")).toBe(
      SecurityPlaybookTargetState.Done,
    );
    expect(stateOf(outcome, "admin@contoso.com")).toBe(
      SecurityPlaybookTargetState.Failed,
    );
    expect(outcome.error).toContain("admin@contoso.com:");
    expect(outcome.error).toContain("User.RevokeSessions.All");
    expect(writes(requests)).toEqual([
      "POST https://graph.microsoft.com/v1.0/users/id-alice%40contoso.com/revokeSignInSessions {}",
      "POST https://graph.microsoft.com/v1.0/users/id-admin%40contoso.com/revokeSignInSessions {}",
    ]);
  });

  test("Enable the user undoes a disabled account, step or one-click alike", async () => {
    const step: RecordingTransport = entraTransport({
      "alice@contoso.com": false,
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.EnableEntraIdUser,
      connection: connection(SecurityEventConnectorProvider.MicrosoftEntraId),
      settings: ENTRA_SETTINGS,
      targets: users("alice@contoso.com"),
      caseNumber: "CASE-9",
      isolationType: DefenderIsolationType.Full,
      transport: step.transport,
    });

    expect(stateOf(outcome, "alice@contoso.com")).toBe(
      SecurityPlaybookTargetState.Done,
    );
    expect(writes(step.requests)).toEqual([
      'PATCH https://graph.microsoft.com/v1.0/users/id-alice%40contoso.com {"accountEnabled":true}',
    ]);

    const oneClick: RecordingTransport = entraTransport({
      "alice@contoso.com": false,
    });
    const undone: ContainmentTargetOutcome =
      await SecurityPlaybookContainment.undo({
        action: SecurityPlaybookActionType.DisableEntraIdUser,
        connection: connection(SecurityEventConnectorProvider.MicrosoftEntraId),
        settings: ENTRA_SETTINGS,
        value: "alice@contoso.com",
        caseNumber: "CASE-9",
        transport: oneClick.transport,
      });

    expect(undone).toEqual({
      state: SecurityPlaybookTargetState.Done,
      detail: "enabled",
    });
  });

  test("refuses a connection to another product before sending anything", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.DisableEntraIdUser,
      connection: connection(SecurityEventConnectorProvider.OktaSystemLog),
      settings: OKTA_SETTINGS,
      targets: users("alice@contoso.com"),
      caseNumber: "CASE-9",
      isolationType: DefenderIsolationType.Full,
      transport: async () => {
        throw new Error("no request should be made");
      },
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toContain(
      "is not a connection to the product this step acts through",
    );
  });

  test("an ended Entra ID session has nothing to undo it", async () => {
    await expect(
      SecurityPlaybookContainment.undo({
        action: SecurityPlaybookActionType.SignOutEntraIdUser,
        connection: connection(SecurityEventConnectorProvider.MicrosoftEntraId),
        settings: ENTRA_SETTINGS,
        value: "alice@contoso.com",
        caseNumber: "CASE-9",
        transport: async () => {
          throw new Error("no request should be made");
        },
      }),
    ).rejects.toThrow(/Nothing undoes/);
  });
});

describe("containment in Google Workspace", () => {
  test("suspends each active user, and says which were suspended already or are unknown", async () => {
    const { requests, transport } = workspaceTransport({
      "bob@example.com": false,
      "carol@example.com": true,
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
      connection: connection(SecurityEventConnectorProvider.GoogleWorkspace),
      settings: WORKSPACE_SETTINGS,
      targets: users("bob@example.com", "carol@example.com", "dan@example.com"),
      caseNumber: "CASE-11",
      isolationType: DefenderIsolationType.Full,
      transport,
    });

    expect(stateOf(outcome, "bob@example.com")).toBe(
      SecurityPlaybookTargetState.Done,
    );
    expect(stateOf(outcome, "carol@example.com")).toBe(
      SecurityPlaybookTargetState.AlreadyDone,
    );
    expect(stateOf(outcome, "dan@example.com")).toBe(
      SecurityPlaybookTargetState.NotFound,
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`dan@example.com`: not found in Google Workspace",
    );
    expect(writes(requests)).toEqual([
      'PUT https://admin.googleapis.com/admin/directory/v1/users/id-bob%40example.com {"suspended":true}',
    ]);
  });

  test("signs a user out, and Unsuspend undoes a suspension with the one-click", async () => {
    const signOut: RecordingTransport = workspaceTransport({
      "bob@example.com": false,
    });

    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SignOutGoogleWorkspaceUser,
      connection: connection(SecurityEventConnectorProvider.GoogleWorkspace),
      settings: WORKSPACE_SETTINGS,
      targets: users("bob@example.com"),
      caseNumber: "CASE-11",
      isolationType: DefenderIsolationType.Full,
      transport: signOut.transport,
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`bob@example.com`: signed out everywhere",
    );
    expect(writes(signOut.requests)).toEqual([
      "POST https://admin.googleapis.com/admin/directory/v1/users/id-bob%40example.com/signOut {}",
    ]);

    const oneClick: RecordingTransport = workspaceTransport({
      "bob@example.com": true,
    });
    const undone: ContainmentTargetOutcome =
      await SecurityPlaybookContainment.undo({
        action: SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
        connection: connection(SecurityEventConnectorProvider.GoogleWorkspace),
        settings: WORKSPACE_SETTINGS,
        value: "bob@example.com",
        caseNumber: "CASE-11",
        transport: oneClick.transport,
      });

    expect(undone).toEqual({
      state: SecurityPlaybookTargetState.Done,
      detail: "unsuspended",
    });
    expect(writes(oneClick.requests)).toEqual([
      'PUT https://admin.googleapis.com/admin/directory/v1/users/id-bob%40example.com {"suspended":false}',
    ]);
  });

  test("a connection whose key no longer reads fails every target with the reason, and contains nothing", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookContainment.run({
      action: SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
      connection: connection(SecurityEventConnectorProvider.GoogleWorkspace),
      settings: {
        ...WORKSPACE_SETTINGS,
        secrets: { serviceAccountJson: "{}" },
      },
      targets: users("bob@example.com", "carol@example.com"),
      caseNumber: "CASE-11",
      isolationType: DefenderIsolationType.Full,
      transport: async () => {
        throw new Error("no request should be made");
      },
    });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(stateOf(outcome, "bob@example.com")).toBe(
      SecurityPlaybookTargetState.Failed,
    );
    expect(stateOf(outcome, "carol@example.com")).toBe(
      SecurityPlaybookTargetState.Failed,
    );
  });
});
