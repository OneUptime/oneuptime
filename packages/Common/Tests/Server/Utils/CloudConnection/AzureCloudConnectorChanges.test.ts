import { describe, expect, test } from "@jest/globals";
import AzureCloudConnector from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import {
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * What changed in an Azure subscription and what Azure says about its
 * health, read from its Activity Log against a fake Resource Manager: a
 * write that ended is a change and its start is not, Service Health and
 * Resource Health are health events, each read starts a little before the
 * last one stopped and writes nothing twice, and a subscription whose log
 * the app may not read is told once.
 */

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SUB_A: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const SUB_B: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const VM: string = `/subscriptions/${SUB_A}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-web-1`;

const connector: AzureCloudConnector = new AzureCloudConnector();

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: CLIENT,
      cloud: "public",
    },
    secrets: { clientSecret: "client-secret~value" },
  };
}

interface FakeActivity extends FakeProviderApi {
  logCalls: Array<URL>;
}

function createFakeActivity(options: {
  events?: Record<string, Array<JSONObject>>;
  errors?: Record<string, FakeResponse>;
  tokenError?: FakeResponse;
}): FakeActivity {
  const logCalls: Array<URL> = [];

  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: "login.microsoftonline.com",
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return (
          options.tokenError ||
          json({ access_token: "azure-access-token", expires_in: 3599 })
        );
      },
    },
    {
      host: "management.azure.com",
      path: "/subscriptions",
      respond: (): FakeResponse => {
        return json({
          value: [
            {
              subscriptionId: SUB_A,
              displayName: "Production",
              state: "Enabled",
            },
          ],
        });
      },
    },
    {
      host: "management.azure.com",
      path: /^\/subscriptions\/[^/]+\/providers\/Microsoft\.Insights\/eventtypes\/management\/values$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        logCalls.push(url);
        const subscription: string = url.pathname.split("/")[2]!;

        if (options.errors?.[subscription]) {
          return options.errors[subscription]!;
        }

        return json({ value: options.events?.[subscription] || [] });
      },
    },
  ]);

  return { ...api, logCalls };
}

function changeOptions(
  fake: FakeProviderApi,
  state: CloudConnectionPullState,
  extra: Partial<CloudChangesOptions> = {},
  now: Date = NOW,
): CloudChangesOptions {
  return {
    transport: fake.transport,
    now: () => {
      return now;
    },
    sleep: async () => {},
    state,
    connectionId: "33333333-3333-4333-8333-333333333333",
    budget: new CloudReadBudget({ maxRequests: 300, maxDurationMs: 60000 }),
    ...extra,
  };
}

function administrative(data: {
  id: string;
  operation: string;
  status: string;
  at: string;
  resourceId?: string;
}): JSONObject {
  return {
    eventDataId: data.id,
    eventTimestamp: data.at,
    category: { value: "Administrative", localizedValue: "Administrative" },
    operationName: { value: data.operation, localizedValue: data.operation },
    status: { value: data.status, localizedValue: data.status },
    caller: "deployer@contoso.com",
    resourceId: data.resourceId ?? VM,
    properties: { requestbody: '{"adminPassword":"hunter2"}' },
  };
}

describe("what changed in an Azure subscription", () => {
  test("a write that ended is a change; its start, a read and a listing of keys are not", async () => {
    const fake: FakeActivity = createFakeActivity({
      events: {
        [SUB_A]: [
          administrative({
            id: "evt-started",
            operation: "Microsoft.Compute/virtualMachines/write",
            status: "Started",
            at: "2026-10-21T11:00:00Z",
          }),
          administrative({
            id: "evt-write",
            operation: "Microsoft.Compute/virtualMachines/write",
            status: "Succeeded",
            at: "2026-10-21T11:01:00Z",
          }),
          administrative({
            id: "evt-restart",
            operation: "Microsoft.Compute/virtualMachines/restart/action",
            status: "Failed",
            at: "2026-10-21T11:05:00Z",
          }),
          administrative({
            id: "evt-keys",
            operation: "Microsoft.Storage/storageAccounts/listKeys/action",
            status: "Succeeded",
            at: "2026-10-21T11:06:00Z",
          }),
        ],
      },
    });
    const state: CloudConnectionPullState = { accounts: [SUB_A] };

    const result: CloudChangesResult = await connector.readChanges(
      settings(),
      changeOptions(fake, state),
    );

    expect(result.changes).toEqual([
      {
        provider: CloudProvider.Azure,
        accountId: SUB_A,
        region: "",
        time: new Date("2026-10-21T11:01:00Z"),
        eventId: "evt-write",
        resources: [{ id: VM }],
        kind: "change",
        operation: "Microsoft.Compute/virtualMachines/write",
        actor: "deployer@contoso.com",
        failed: false,
      },
      {
        provider: CloudProvider.Azure,
        accountId: SUB_A,
        region: "",
        time: new Date("2026-10-21T11:05:00Z"),
        eventId: "evt-restart",
        resources: [{ id: VM }],
        kind: "change",
        operation: "Microsoft.Compute/virtualMachines/restart/action",
        actor: "deployer@contoso.com",
        failed: true,
      },
    ]);
    expect(JSON.stringify(result.changes)).not.toContain("hunter2");

    const call: URL = fake.logCalls[0]!;
    expect(call.searchParams.get("$filter")).toBe(
      `eventTimestamp ge '2026-10-21T10:07:00.000Z' and eventTimestamp le '${NOW.toISOString()}'`,
    );
    expect(call.searchParams.get("$select")).not.toContain("claims");
    expect(state.changeCursors).toEqual({ [SUB_A]: NOW.toISOString() });
  });

  test("Service Health and Resource Health are health events, in Azure's words", async () => {
    const fake: FakeActivity = createFakeActivity({
      events: {
        [SUB_A]: [
          {
            eventDataId: "evt-service",
            eventTimestamp: "2026-10-21T11:10:00Z",
            category: { value: "ServiceHealth" },
            operationName: { value: "Microsoft.ServiceHealth/incident/action" },
            resourceId: `/subscriptions/${SUB_A}`,
            properties: {
              title: "Storage - West Europe - Degraded performance",
              incidentType: "Incident",
              trackingId: "ABC-123",
              stage: "Active",
            },
          },
          {
            eventDataId: "evt-resource",
            eventTimestamp: "2026-10-21T11:12:00Z",
            category: { value: "ResourceHealth" },
            operationName: {
              value: "Microsoft.Resourcehealth/healthevent/Activated/action",
            },
            resourceId: VM,
            properties: {
              title: "Virtual machine is unavailable",
              currentHealthStatus: "Unavailable",
              previousHealthStatus: "Available",
              cause: "PlatformInitiated",
            },
          },
        ],
      },
    });

    const result: CloudChangesResult = await connector.readChanges(
      settings(),
      changeOptions(fake, { accounts: [SUB_A] }),
    );

    expect(
      result.changes.map((change: CloudChange) => {
        return {
          kind: change.kind,
          title: change.title,
          description: change.description,
          resources: change.resources,
        };
      }),
    ).toEqual([
      {
        kind: "health",
        title:
          "Azure Service Health: Storage - West Europe - Degraded performance (Active)",
        description:
          "Incident published by Azure, tracking id ABC-123, stage Active.",
        resources: [],
      },
      {
        kind: "health",
        title: "Azure Resource Health: Available → Unavailable",
        description: "Virtual machine is unavailable. Azure caused it.",
        resources: [{ id: VM }],
      },
    ]);
  });

  test("the next read starts twenty minutes before the last one stopped and writes nothing twice", async () => {
    const first: JSONObject = administrative({
      id: "evt-a",
      operation: "Microsoft.Web/sites/write",
      status: "Succeeded",
      at: "2026-10-21T12:00:00Z",
    });
    const state: CloudConnectionPullState = { accounts: [SUB_A] };

    await connector.readChanges(
      settings(),
      changeOptions(
        createFakeActivity({ events: { [SUB_A]: [first] } }),
        state,
      ),
    );

    const later: Date = new Date("2026-10-21T12:12:00Z");
    const fake: FakeActivity = createFakeActivity({
      events: {
        [SUB_A]: [
          first,
          administrative({
            id: "evt-b",
            operation: "Microsoft.Web/sites/config/write",
            status: "Succeeded",
            at: "2026-10-21T12:09:00Z",
          }),
        ],
      },
    });

    const second: CloudChangesResult = await connector.readChanges(
      settings(),
      changeOptions(fake, state, {}, later),
    );

    expect(
      second.changes.map((change: CloudChange): string => {
        return change.eventId;
      }),
    ).toEqual(["evt-b"]);
    expect(fake.logCalls[0]!.searchParams.get("$filter")).toContain(
      "eventTimestamp ge '2026-10-21T11:47:00.000Z'",
    );
  });

  test("a subscription whose Activity Log the app may not read is told once; the others are read", async () => {
    const fake: FakeActivity = createFakeActivity({
      events: {
        [SUB_A]: [
          administrative({
            id: "evt-a",
            operation: "Microsoft.Sql/servers/databases/write",
            status: "Succeeded",
            at: "2026-10-21T11:30:00Z",
          }),
        ],
      },
      errors: {
        [SUB_B]: json(
          {
            error: {
              code: "AuthorizationFailed",
              message: "The client does not have authorization.",
            },
          },
          403,
        ),
      },
    });
    const state: CloudConnectionPullState = { accounts: [SUB_A, SUB_B] };

    const result: CloudChangesResult = await connector.readChanges(
      settings(),
      changeOptions(fake, state),
    );

    expect(result.changes).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([
      "The app may not read a subscription's Activity Log. Give it the Monitoring Reader role on it.",
    ]);
    expect(Object.keys(state.changeCursors || {})).toEqual([SUB_A]);
  });

  test("an expired client secret says so", async () => {
    const fake: FakeActivity = createFakeActivity({
      tokenError: json(
        {
          error: "invalid_client",
          error_description:
            "AADSTS7000222: The provided client secret keys for app are expired.",
        },
        401,
      ),
    });

    let failure: unknown = null;

    try {
      await connector.readChanges(
        settings(),
        changeOptions(fake, { accounts: [SUB_A] }),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
    expect((failure as LlmProviderError).message).toBe(
      "The app's client secret has expired. Run the setup command again and paste what it prints.",
    );
  });

  test("an investigation's look back reads only the subscriptions it names and moves no cursor", async () => {
    const fake: FakeActivity = createFakeActivity({});
    const state: CloudConnectionPullState = { accounts: [SUB_A, SUB_B] };
    const since: Date = new Date("2026-10-21T08:00:00Z");

    await connector.readChanges(
      settings(),
      changeOptions(fake, state, {
        since,
        only: [{ accountId: SUB_B.toUpperCase() }],
      }),
    );

    expect(fake.logCalls).toHaveLength(1);
    expect(fake.logCalls[0]!.pathname).toContain(SUB_B);
    expect(fake.logCalls[0]!.searchParams.get("$filter")).toContain(
      `eventTimestamp ge '${since.toISOString()}'`,
    );
    expect(state.changeCursors).toBeUndefined();
  });
});
