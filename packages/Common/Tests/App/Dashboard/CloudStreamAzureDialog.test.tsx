import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * Stream metrics and logs, on an Azure connection's row in Cloud > Connect:
 * the dialog that sets Azure Monitor up to send a subscription's metrics
 * and resource logs to event hubs OneUptime reads, drawn for real - the
 * option picker, the numbered steps, the command, the fold - with the
 * network stubbed:
 *
 *   - one question, what to stream, then three steps: turn reading on, run
 *     one command in Azure Cloud Shell, wait for the first events;
 *   - the command is written for the connection's own app and the
 *     subscriptions it reads - the first holds the event hubs - and sends
 *     what was chosen: metrics, logs or both;
 *   - Turn on reading asks the server to read the event hubs in the first
 *     subscription, and tells the list; reading on for that subscription
 *     says since when; on for another one, it offers to read them in the
 *     first listed instead;
 *   - what stops a command being written - no app, no subscription, one
 *     that is no ID - is said, and nothing can be turned on;
 *   - the last step asks every few seconds what arrived, in Azure's words:
 *     waiting, what came from where, or why the event hubs could not be
 *     read;
 *   - the subscriptions and the names for setting it up another way are
 *     under More fields - unless the connection has read no subscription
 *     yet, when the dialog asks for them under its question;
 *   - while reading is on, a listed subscription that is no ID never turns
 *     the first step into a question mark: it keeps saying where it reads;
 *   - Turn on reading starts where the step's words start, and a locked one
 *     says why.
 *
 * And the words and choices behind it, which are React-free.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    HOST: "oneuptime.example.com",
    HTTP_PROTOCOL: "https://",
  };
});

import CloudStreamAzureDialog from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamAzureDialog";
import {
  CLOUD_STREAM_COMMAND_MAX_HEIGHT,
  CLOUD_STREAM_DIALOG_TEST_ID,
  CLOUD_STREAM_STEP_BUTTON_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamParts";
import { CLOUD_STREAM_POLL_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectApi";
import {
  AZURE_STREAM_DOCS_PATH,
  getAzureStreamDefaultSubscriptions,
  getAzureStreamSetup,
  getAzureStreamStartSubscriptions,
  getAzureStreamStopCommand,
  getDefaultAzureStreamChoices,
  isAzureStreamSubscriptionsProblem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamAzureSetup";
import { CloudStreamWhat } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamSetup";
import {
  AZURE_STREAM_FAILED_SENTENCE,
  AZURE_STREAM_REFUSAL_WORDS,
  AZURE_STREAM_WAITING_SENTENCE,
  CloudStreamStatusWords,
  getCloudStreamRefusalWords,
  getCloudStreamSourceWords,
  getCloudStreamStatusWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamWords";
import { CloudTemplate } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionWords";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import { Red } from "../../../Types/BrandColors";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudStreamRefusalReason } from "../../../Types/CloudConnection/CloudStream";
import {
  AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE,
  AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS,
  STREAM_NOT_A_SUBSCRIPTION,
  STREAM_NO_APP,
  STREAM_NO_SUBSCRIPTION,
  STREAM_TOO_MANY_SUBSCRIPTIONS,
} from "../../../Types/CloudConnection/CloudStreamAzure";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const CONNECTION_ID: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const APP_ID: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SUB_A: string = "11111111-aaaa-4aaa-8aaa-111111111111";
const SUB_B: string = "22222222-bbbb-4bbb-8bbb-222222222222";
const GROUP: string = "oneuptime-stream-6f1c3a2e";
const NOW: Date = new Date("2026-11-06T10:00:00.000Z");

let postSpy: jest.SpyInstance<any, any>;
let getItemSpy: jest.SpyInstance<any, any>;

function connection(fields: Partial<CloudConnection> = {}): CloudConnection {
  const item: CloudConnection = new CloudConnection();
  item._id = CONNECTION_ID;
  item.name = "Contoso production";
  item.provider = CloudProvider.Azure;
  item.isEnabled = true;
  item.config = {
    authMethod: "azure-client-secret",
    tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
    clientId: APP_ID,
    cloud: "public",
  };
  item.lastPullResult = {
    status: "success",
    accounts: [SUB_A, SUB_B],
    regions: [{ region: "eastus", count: 12 }],
  };
  Object.assign(item, fields);
  return item;
}

function minutesAgo(minutes: number, from: Date = new Date()): string {
  return new Date(from.getTime() - minutes * 60 * 1000).toISOString();
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/connect`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  postSpy = getJestSpyOn(API, "post").mockResolvedValue({
    data: { startedAt: NOW.toISOString() },
  });
  getItemSpy = getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function openDialog(
  item: CloudConnection = connection(),
  onChanged: MockFunction = getJestMockFunction(),
): void {
  render(
    <CloudStreamAzureDialog
      connection={item}
      onClose={getJestMockFunction()}
      onChanged={onChanged}
    />,
  );
}

function part(name: string): HTMLElement {
  return screen.getByTestId(`${CLOUD_STREAM_DIALOG_TEST_ID}-${name}`);
}

function queryPart(name: string): HTMLElement | null {
  return screen.queryByTestId(`${CLOUD_STREAM_DIALOG_TEST_ID}-${name}`);
}

// The command as the code block shows it.
function command(): string {
  return part("command").querySelector("pre code")?.textContent || "";
}

async function choose(what: CloudStreamWhat): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`setup-guide-option-${what}`));
  });
}

async function openMoreFields(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(part("more-fields")).getByTestId("folded-section-header"),
    );
  });
}

async function startReading(): Promise<void> {
  await act(async () => {
    fireEvent.click(part("start-reading"));
  });
}

describe("how an Azure stream is said to be doing", () => {
  test("nothing before reading is on; then waiting, receiving and quiet, in Azure's words", () => {
    expect(
      getCloudStreamStatusWords({
        provider: CloudProvider.Azure,
        streamKeyCreatedAt: null,
        streamSummary: { lastDeliveryAt: minutesAgo(1, NOW) },
        now: NOW,
      }),
    ).toBeNull();

    const waiting: CloudStreamStatusWords = getCloudStreamStatusWords({
      provider: CloudProvider.Azure,
      streamKeyCreatedAt: NOW,
      streamSummary: null,
      now: NOW,
    })!;

    expect(waiting.label).toBe("Stream waiting");
    expect(waiting.sentence).toEqual({
      template: AZURE_STREAM_WAITING_SENTENCE,
      values: {},
    });

    expect(
      getCloudStreamStatusWords({
        provider: CloudProvider.Azure,
        streamKeyCreatedAt: NOW,
        streamSummary: { lastDeliveryAt: minutesAgo(1, NOW) },
        now: NOW,
      })!.sentence.template,
    ).toBe("Receiving. The last events came {{time}}.");
    expect(
      getCloudStreamStatusWords({
        provider: CloudProvider.Azure,
        streamKeyCreatedAt: NOW,
        streamSummary: { lastDeliveryAt: minutesAgo(30, NOW) },
        now: NOW,
      })!.sentence.template,
    ).toBe(
      "No events since {{time}}: the connection reads its metrics on its schedule again until they come.",
    );
  });

  test("a read that failed is said as failing, not refused: OneUptime reads, nothing is pushed to it", () => {
    const failing: CloudStreamStatusWords = getCloudStreamStatusWords({
      provider: CloudProvider.Azure,
      streamKeyCreatedAt: NOW,
      streamSummary: {
        lastRefusal: {
          reason: CloudStreamRefusalReason.NoAccess,
          at: minutesAgo(1, NOW),
        },
      },
      now: NOW,
    })!;

    expect(failing.state).toBe("refused");
    expect(failing.label).toBe("Stream failing");
    expect(failing.color).toEqual(Red);
    expect(failing.sentence.template).toBe(AZURE_STREAM_FAILED_SENTENCE);
    expect(JSON.stringify(failing.sentence.values)).toContain(
      "The connection's app may not read the event hubs.",
    );
    expect(JSON.stringify(failing.sentence.values)).toContain(
      AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE,
    );

    // A read that went well since: no longer failing, though nothing new came.
    expect(
      getCloudStreamStatusWords({
        provider: CloudProvider.Azure,
        streamKeyCreatedAt: NOW,
        streamSummary: {
          lastReadAt: minutesAgo(0.5, NOW),
          lastRefusal: {
            reason: CloudStreamRefusalReason.Unreachable,
            at: minutesAgo(1, NOW),
          },
        },
        now: NOW,
      })!.state,
    ).toBe("waiting");
  });

  test("every reason a read fails for says what happened and what to do; an unknown one is said as unreachable", () => {
    for (const reason of [
      CloudStreamRefusalReason.NoAccess,
      CloudStreamRefusalReason.Unreachable,
      CloudStreamRefusalReason.TurnedOff,
      CloudStreamRefusalReason.NotAllowed,
    ]) {
      const words: { reason: string; advice: string } =
        getCloudStreamRefusalWords({ provider: "azure", reason });

      expect(words).toBe(AZURE_STREAM_REFUSAL_WORDS[reason]);
      expect(words.reason.length).toBeGreaterThan(10);
      expect(words.advice.length).toBeGreaterThan(10);
    }

    // A push's reason never comes from a read: the read's own words stand in.
    expect(
      getCloudStreamRefusalWords({
        provider: "azure",
        reason: CloudStreamRefusalReason.WrongKey,
      }),
    ).toBe(AZURE_STREAM_REFUSAL_WORDS[CloudStreamRefusalReason.Unreachable]);
  });

  test("what arrived: resource types and log categories, a line a region, the subscription once there are several", () => {
    const at: string = minutesAgo(1, NOW);
    const one: Array<CloudTemplate> = getCloudStreamSourceWords(
      {
        metricSources: [
          {
            accountId: SUB_A,
            region: "eastus",
            namespaces: [
              "Microsoft.Compute/virtualMachines",
              "Microsoft.Web/sites",
            ],
            lastAt: at,
          },
        ],
        logSources: [
          {
            accountId: SUB_A,
            region: "westeurope",
            logGroups: ["AuditEvent", "AppServiceHTTPLogs", "FunctionAppLogs"],
            lastAt: at,
          },
        ],
      },
      CloudProvider.Azure,
    );

    expect(one).toEqual([
      {
        template: "Metrics of {{count}} resource types from {{region}}",
        values: { region: "eastus" },
        plural: {
          one: "Metrics of {{count}} resource type from {{region}}",
          count: 2,
        },
      },
      {
        template: "Logs of {{count}} categories from {{region}}",
        values: { region: "westeurope" },
        plural: {
          one: "Logs of {{count}} category from {{region}}",
          count: 3,
        },
      },
    ]);

    const two: Array<CloudTemplate> = getCloudStreamSourceWords(
      {
        metricSources: [],
        logSources: [
          {
            accountId: SUB_A,
            region: "eastus",
            logGroups: ["AuditEvent"],
            lastAt: at,
          },
          {
            accountId: SUB_B,
            region: "eastus",
            logGroups: ["AuditEvent"],
            lastAt: at,
          },
        ],
      },
      CloudProvider.Azure,
    );

    expect(
      two.map((line: CloudTemplate) => {
        return line.values["region"];
      }),
    ).toEqual([`eastus (${SUB_A})`, `eastus (${SUB_B})`]);
  });
});

describe("the subscriptions it streams from", () => {
  test("the ones the connection is set to read, as typed", () => {
    expect(
      getAzureStreamDefaultSubscriptions({
        config: { subscriptionIds: `${SUB_B.toUpperCase()}, ${SUB_A}` },
        lastPullResult: { accounts: [SUB_A] },
      }),
    ).toEqual([SUB_B, SUB_A]);
  });

  test("else the ones its last read reached - subscription IDs only", () => {
    expect(
      getAzureStreamDefaultSubscriptions({
        config: { subscriptionIds: "" },
        lastPullResult: { accounts: [SUB_A, "Contoso Production", SUB_A] },
      }),
    ).toEqual([SUB_A]);
    expect(getAzureStreamDefaultSubscriptions({})).toEqual([]);
  });

  test("while reading is on, the one whose event hubs are read first, however the read lists them", () => {
    const read: { accounts: Array<string> } = { accounts: [SUB_A, SUB_B] };

    expect(
      getAzureStreamStartSubscriptions({
        readSubscriptionId: SUB_B.toUpperCase(),
        lastPullResult: read,
      }),
    ).toEqual([SUB_B, SUB_A]);
    // One the connection does not read: first, then the ones it reads.
    expect(
      getAzureStreamStartSubscriptions({
        readSubscriptionId: "33333333-cccc-4ccc-8ccc-333333333333",
        lastPullResult: read,
      }),
    ).toEqual(["33333333-cccc-4ccc-8ccc-333333333333", SUB_A, SUB_B]);
    // Reading off, or no subscription said: the ones it reads, as they are.
    expect(
      getAzureStreamStartSubscriptions({
        readSubscriptionId: null,
        lastPullResult: read,
      }),
    ).toEqual([SUB_A, SUB_B]);
    expect(
      getAzureStreamStartSubscriptions({
        readSubscriptionId: "prod",
        lastPullResult: read,
      }),
    ).toEqual([SUB_A, SUB_B]);
  });

  test("the first holds the event hubs; what stops a command is said", () => {
    const setup: ReturnType<typeof getAzureStreamSetup> = getAzureStreamSetup({
      choices: getDefaultAzureStreamChoices([SUB_B, SUB_A]),
      connectionId: CONNECTION_ID,
      appId: APP_ID,
    });

    expect(setup.hostSubscriptionId).toBe(SUB_B);
    expect(setup.problem).toBeNull();
    expect(setup.names.resourceGroup).toBe(GROUP);

    for (const [subscriptionsText, appId, problem] of [
      ["", APP_ID, STREAM_NO_SUBSCRIPTION],
      ["prod", APP_ID, STREAM_NOT_A_SUBSCRIPTION],
      [SUB_A, "", STREAM_NO_APP],
    ] as Array<[string, string, string]>) {
      const failed: ReturnType<typeof getAzureStreamSetup> =
        getAzureStreamSetup({
          choices: { what: CloudStreamWhat.Metrics, subscriptionsText },
          connectionId: CONNECTION_ID,
          appId,
        });

      expect(failed.problem?.text).toBe(problem);
      expect(failed.command).toBe("");
      expect(failed.hostSubscriptionId).toBe("");
    }
  });

  test("Stop streaming's command deletes in the subscription its event hubs are read in, then the ones it reads", () => {
    const text: string = getAzureStreamStopCommand({
      connectionId: CONNECTION_ID,
      hostSubscriptionId: "33333333-cccc-4ccc-8ccc-333333333333",
      config: {},
      lastPullResult: { accounts: [SUB_A] },
    });

    expect(text).toContain(
      `for SUB in '33333333-cccc-4ccc-8ccc-333333333333' '${SUB_A}'; do`,
    );
    expect(text).toContain(
      "az monitor diagnostic-settings delete --name OneUptime-6f1c3a2e",
    );
    expect(text).toContain(
      `az group delete --subscription "$SUB" --name ${GROUP}`,
    );
  });
});

describe("the dialog", () => {
  test("asks what to stream, then three steps; the command is the connection's app's, for the subscriptions it reads", () => {
    openDialog();

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Stream metrics and logs",
    );
    expect(screen.getByTestId(CLOUD_STREAM_DIALOG_TEST_ID)).toHaveAttribute(
      "data-provider",
      "azure",
    );

    const question: HTMLElement = part("question");

    expect(question).toHaveTextContent("What should it stream?");
    expect(
      within(question)
        .getAllByRole("radio")
        .map((option: HTMLElement) => {
          return [
            option.getAttribute("data-testid"),
            option.getAttribute("aria-checked"),
          ];
        }),
    ).toEqual([
      ["setup-guide-option-metrics", "true"],
      ["setup-guide-option-metrics-and-logs", "false"],
      ["setup-guide-option-logs", "false"],
    ]);

    const steps: Array<HTMLElement> = [1, 2, 3].map((index: number) => {
      return screen.getByTestId(`setup-guide-step-${index}`);
    });

    expect(steps[0]).toHaveTextContent("Turn on reading");
    expect(steps[1]).toHaveTextContent("Run this in Azure Cloud Shell");
    expect(steps[1]).toHaveTextContent(
      "an Owner, or a Contributor who is also a User Access Administrator.",
    );
    expect(steps[2]).toHaveTextContent("Wait for the first events");

    // The connection's own app, reading the event hubs of the subscriptions it reads.
    expect(command()).toContain(`local APP='${APP_ID}'`);
    expect(command()).toContain(`local HOST='${SUB_A}'`);
    expect(command()).toContain(`for SUB in '${SUB_A}' '${SUB_B}'; do`);
    // Metrics alone, at first.
    expect(command()).toContain('--metrics "$METRICS"');
    expect(command()).not.toContain('--logs "$LOGS"');
    expect(part("open-shell")).toHaveAttribute(
      "href",
      "https://shell.azure.com",
    );
    expect(part("what-it-makes")).toHaveTextContent(GROUP);
    expect(part("what-it-makes")).toHaveTextContent(
      AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE,
    );
    expect(part("live")).toHaveAttribute("data-state", "no-key");
    expect(part("start-reading")).toBeEnabled();
    // Nothing asked of the server until reading is turned on.
    expect(postSpy).not.toHaveBeenCalled();

    // The step's own button starts where its words start, not a footer's margin in.
    expect(part("start-reading")).toHaveClass(
      CLOUD_STREAM_STEP_BUTTON_CLASS_NAME,
    );
    expect(steps[0]).toHaveTextContent(
      "Every minute, OneUptime reads the event hubs the command makes, signed in as the connection's app. Turn reading on first: until they are there, it waits for them.",
    );
    // As tall as every streaming command at most, before it scrolls.
    expect(
      (part("command").querySelector("pre")?.parentElement as HTMLElement).style
        .maxHeight,
    ).toBe(CLOUD_STREAM_COMMAND_MAX_HEIGHT);
  });

  test("metrics and logs send both, as Azure allows each resource; logs alone send logs only", async () => {
    openDialog();

    await choose(CloudStreamWhat.MetricsAndLogs);

    expect(command()).toContain('--logs "$LOGS" --metrics "$METRICS"');
    expect(command()).toContain('--metrics "$METRICS" --output none');
    expect(command()).toContain('--logs "$LOGS" --output none');

    await choose(CloudStreamWhat.Logs);

    expect(command()).toContain('--logs "$LOGS"');
    expect(command()).not.toContain('--metrics "$METRICS"');
  });

  test("Turn on reading asks for the event hubs of the first subscription, and tells the list", async () => {
    const onChanged: MockFunction = getJestMockFunction();
    openDialog(connection(), onChanged);

    await startReading();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]![0].url.toString()).toMatch(
      new RegExp(`/cloud-connection/${CONNECTION_ID}/start-streaming$`),
    );
    expect(postSpy.mock.calls[0]![0].data).toEqual({
      hostSubscriptionId: SUB_A,
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(part("reading")).toHaveTextContent(
      `Reading is on, since ${OneUptimeDate.getDateAsLocalShortDateTimeString(NOW)}: OneUptime reads the event hubs in subscription ${SUB_A} every minute.`,
    );
    expect(queryPart("start-reading")).not.toBeInTheDocument();
    // Now on: the last step waits for the first events.
    expect(part("live")).toHaveAttribute("data-state", "waiting");
    expect(part("live")).toHaveTextContent(
      "Waiting for the first events. Azure sends them within a few minutes of the command finishing, and OneUptime reads the event hubs every minute.",
    );
  });

  test("opened while reading is on, it starts on the subscription read in, though the read lists it second", () => {
    const startedAt: Date = new Date("2026-11-05T08:00:00.000Z");
    openDialog(
      connection({
        streamKeyCreatedAt: startedAt,
        streamState: { hostSubscriptionId: SUB_B, offsets: {} },
      }),
    );

    expect(part("reading")).toHaveTextContent(
      `OneUptime reads the event hubs in subscription ${SUB_B} every minute.`,
    );
    expect(command()).toContain(`local HOST='${SUB_B}'`);
    expect(command()).toContain(`for SUB in '${SUB_B}' '${SUB_A}'; do`);
    expect(queryPart("start-reading")).not.toBeInTheDocument();
  });

  test("on for another subscription than the first listed, it says so, and reads them in the first listed instead", async () => {
    const startedAt: Date = new Date("2026-11-05T08:00:00.000Z");
    openDialog(
      connection({
        streamKeyCreatedAt: startedAt,
        streamState: { hostSubscriptionId: SUB_B, offsets: {} },
      }),
    );

    await openMoreFields();
    await act(async () => {
      fireEvent.change(part("subscriptions"), {
        target: { value: `${SUB_A}, ${SUB_B}` },
      });
    });

    expect(part("start")).toHaveTextContent(
      `OneUptime reads the event hubs in subscription ${SUB_B}, and this command makes them in ${SUB_A}, the first listed. Read them there before you run it.`,
    );
    expect(part("start-reading")).toHaveTextContent("Read them there");

    await startReading();

    expect(postSpy.mock.calls[0]![0].data).toEqual({
      hostSubscriptionId: SUB_A,
    });
    expect(part("reading")).toHaveTextContent(SUB_A);
  });

  test("on for the subscription the command makes them in, it says since when, and asks nothing", () => {
    const startedAt: Date = new Date("2026-11-05T08:00:00.000Z");
    openDialog(
      connection({
        streamKeyCreatedAt: startedAt,
        streamState: { hostSubscriptionId: SUB_A, offsets: { x: { "0": 1 } } },
      }),
    );

    expect(part("reading")).toHaveTextContent(
      OneUptimeDate.getDateAsLocalShortDateTimeString(startedAt),
    );
    expect(queryPart("start-reading")).not.toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("reading the server would not turn on says why, and can be tried again", async () => {
    postSpy.mockRejectedValue(
      new Error("Give the subscription the event hubs are in, as its ID."),
    );
    const onChanged: MockFunction = getJestMockFunction();
    openDialog(connection(), onChanged);

    await startReading();

    expect(part("start-error")).toHaveTextContent(
      "Give the subscription the event hubs are in, as its ID.",
    );
    expect(part("start-error")).toHaveAttribute("role", "alert");
    expect(onChanged).not.toHaveBeenCalled();
    expect(part("start-reading")).toBeEnabled();
  });

  test("a connection that says no app, or no subscription, gets no command and cannot turn reading on", async () => {
    openDialog(connection({ config: { authMethod: "azure-client-secret" } }));

    expect(part("problem")).toHaveTextContent(
      "This connection does not say which app registration it reads with.",
    );
    expect(queryPart("command")).not.toBeInTheDocument();
    expect(part("start-reading")).toBeDisabled();
    // Locked, it says why where a pointer, a tap or the keyboard reaches it.
    expect(part("start-reading-disabled-wrapper")).toHaveAttribute(
      "tabindex",
      "0",
    );

    cleanup();
    openDialog(
      connection({ lastPullResult: { status: "success", accounts: [] } }),
    );

    expect(part("problem")).toHaveTextContent(
      "List at least one subscription to stream from.",
    );
    expect(part("start-reading")).toBeDisabled();
    expect(part("start-reading-disabled-wrapper")).toBeInTheDocument();
  });

  test("a connection that has read no subscription yet asks for them under the question, where they stay while typed in", async () => {
    openDialog(
      connection({ lastPullResult: { status: "success", accounts: [] } }),
    );

    // Asked for in a box of its own, between the question and the steps.
    const asked: HTMLElement = part("subscriptions-asked");

    expect(asked).toHaveTextContent(
      "Subscription IDs, separated by commas: this connection has read none yet. The first holds the event hubs, and OneUptime reads them there.",
    );
    expect(within(asked).getByLabelText("Subscriptions")).toBe(
      part("subscriptions"),
    );
    expect(part("subscriptions")).toHaveValue("");
    expect(
      part("question").compareDocumentPosition(asked) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      asked.compareDocumentPosition(screen.getByTestId("setup-guide-steps")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // So More fields no longer holds it, nor names it.
    expect(part("more-fields")).not.toHaveTextContent("Subscriptions");
    expect(part("more-fields")).toHaveTextContent("Set it up another way");

    await act(async () => {
      fireEvent.change(part("subscriptions"), {
        target: { value: `${SUB_B}, ${SUB_A}` },
      });
    });

    // Typed in: the command, and reading, in the first.
    expect(queryPart("problem")).not.toBeInTheDocument();
    expect(command()).toContain(`local HOST='${SUB_B}'`);
    expect(part("start-reading")).toBeEnabled();
    // Still where it was typed in, and the only such field once More fields opens.
    expect(
      within(part("subscriptions-asked")).getByLabelText("Subscriptions"),
    ).toHaveValue(`${SUB_B}, ${SUB_A}`);

    await openMoreFields();

    expect(
      screen.getAllByTestId(`${CLOUD_STREAM_DIALOG_TEST_ID}-subscriptions`),
    ).toHaveLength(1);
    expect(part("resource-group")).toHaveTextContent(GROUP);

    await startReading();

    expect(postSpy.mock.calls[0]![0].data).toEqual({
      hostSubscriptionId: SUB_B,
    });
  });

  test("a connection that knows its subscriptions keeps them folded under More fields", () => {
    openDialog();

    expect(queryPart("subscriptions-asked")).not.toBeInTheDocument();
    expect(part("more-fields")).toContainElement(part("subscriptions"));
    expect(part("more-fields")).toHaveTextContent("Subscriptions: 2");
  });

  test("a tenant's every subscription, more than one command sets up, is asked for under the question too", async () => {
    const many: Array<string> = Array.from(
      { length: AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS + 1 },
      (_value: unknown, index: number): string => {
        return `${String(index).padStart(8, "0")}-aaaa-4aaa-8aaa-111111111111`;
      },
    );
    openDialog(
      connection({ lastPullResult: { status: "success", accounts: many } }),
    );

    expect(part("problem")).toHaveTextContent(
      `List at most ${AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS} subscriptions.`,
    );
    // Its line is the one that says where the list came from, not that there is none.
    expect(part("subscriptions-asked")).toHaveTextContent(
      "Subscription IDs, separated by commas: at first, the ones this connection reads.",
    );
    expect(part("subscriptions")).toHaveValue(many.join(", "));

    await act(async () => {
      fireEvent.change(part("subscriptions"), {
        target: { value: many.slice(0, 3).join(", ") },
      });
    });

    expect(queryPart("problem")).not.toBeInTheDocument();
    expect(command()).toContain(`local HOST='${many[0]}'`);
  });

  test("only the subscriptions' own problems are the person's to put right in the dialog", () => {
    for (const text of [
      STREAM_NO_SUBSCRIPTION,
      STREAM_NOT_A_SUBSCRIPTION,
      STREAM_TOO_MANY_SUBSCRIPTIONS,
    ]) {
      expect(isAzureStreamSubscriptionsProblem({ text, values: {} })).toBe(
        true,
      );
    }

    expect(
      isAzureStreamSubscriptionsProblem({ text: STREAM_NO_APP, values: {} }),
    ).toBe(false);
    expect(isAzureStreamSubscriptionsProblem(null)).toBe(false);
  });

  test("a connection that names no app keeps its subscriptions folded: its form is what to fix", () => {
    openDialog(
      connection({
        config: { authMethod: "azure-client-secret" },
        lastPullResult: { status: "success", accounts: [] },
      }),
    );

    expect(part("problem")).toHaveTextContent(
      "This connection does not say which app registration it reads with.",
    );
    expect(queryPart("subscriptions-asked")).not.toBeInTheDocument();
  });

  test("while reading is on, a listed subscription that is no ID keeps saying where it reads - never a question mark", async () => {
    const startedAt: Date = new Date("2026-11-05T08:00:00.000Z");
    openDialog(
      connection({
        streamKeyCreatedAt: startedAt,
        streamState: { hostSubscriptionId: SUB_B, offsets: {} },
      }),
    );

    await openMoreFields();
    await act(async () => {
      fireEvent.change(part("subscriptions"), {
        target: { value: "prod-subscription" },
      });
    });

    expect(part("problem")).toHaveTextContent(
      "List subscriptions by their IDs, such as 00000000-0000-0000-0000-000000000000.",
    );
    expect(part("reading")).toHaveTextContent(
      `OneUptime reads the event hubs in subscription ${SUB_B} every minute.`,
    );
    expect(queryPart("start")).not.toBeInTheDocument();
    expect(queryPart("start-reading")).not.toBeInTheDocument();
    expect(screen.getByTestId("setup-guide-step-1")).not.toHaveTextContent("?");

    // A first one that is an ID again: it offers to read them there.
    await act(async () => {
      fireEvent.change(part("subscriptions"), {
        target: { value: SUB_A },
      });
    });

    expect(part("start")).toHaveTextContent(
      `OneUptime reads the event hubs in subscription ${SUB_B}, and this command makes them in ${SUB_A}, the first listed.`,
    );
  });

  test("More fields holds the subscriptions, and the names to set it up another way", async () => {
    openDialog();

    const fold: HTMLElement = part("more-fields");

    expect(fold).toHaveTextContent("Subscriptions: 2");
    expect(fold).toHaveTextContent("Set it up another way");

    await openMoreFields();

    expect(part("subscriptions")).toHaveValue(`${SUB_A}, ${SUB_B}`);
    expect(part("resource-group")).toHaveTextContent(GROUP);
    expect(part("namespace-prefix")).toHaveTextContent("oneuptime-6f1c3a2e-");
    expect(part("event-hub")).toHaveTextContent("oneuptime");
    expect(part("diagnostic-setting")).toHaveTextContent("OneUptime-6f1c3a2e");
    expect(part("guide").getAttribute("href")).toContain(
      AZURE_STREAM_DOCS_PATH.slice("/docs".length),
    );

    // The first listed holds the event hubs.
    await act(async () => {
      fireEvent.change(part("subscriptions"), {
        target: { value: `${SUB_B}, ${SUB_A}` },
      });
    });

    expect(command()).toContain(`local HOST='${SUB_B}'`);
  });

  test("the last step asks every few seconds what arrived, and says it, with where it came from", async () => {
    jest.useFakeTimers();
    const lastDeliveryAt: string = minutesAgo(1);
    getItemSpy.mockResolvedValue(
      connection({
        streamKeyCreatedAt: new Date(minutesAgo(30)),
        streamState: { hostSubscriptionId: SUB_A, offsets: {} },
        streamSummary: {
          lastDeliveryAt,
          lastReadAt: lastDeliveryAt,
          metricSources: [
            {
              accountId: SUB_A,
              region: "eastus",
              namespaces: ["Microsoft.Web/sites"],
              lastAt: lastDeliveryAt,
            },
          ],
          logSources: [],
        },
      }),
    );
    openDialog(
      connection({
        streamKeyCreatedAt: new Date(minutesAgo(30)),
        streamState: { hostSubscriptionId: SUB_A, offsets: {} },
      }),
    );

    expect(part("live")).toHaveAttribute("data-state", "waiting");

    await act(async () => {
      jest.advanceTimersByTime(CLOUD_STREAM_POLL_MS);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(part("live")).toHaveAttribute("data-state", "receiving");
    expect(part("live")).toHaveTextContent(
      `Receiving. The last events came ${OneUptimeDate.getDateAsLocalShortDateTimeString(new Date(lastDeliveryAt))}.`,
    );
    expect(part("sources")).toHaveTextContent(
      "Metrics of 1 resource type from eastus",
    );
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  test("event hubs that could not be read say why, and what to do", () => {
    openDialog(
      connection({
        streamKeyCreatedAt: new Date(minutesAgo(30)),
        streamState: { hostSubscriptionId: SUB_A, offsets: {} },
        streamSummary: {
          lastRefusal: {
            reason: CloudStreamRefusalReason.Unreachable,
            at: minutesAgo(2),
          },
        } as JSONObject,
      }),
    );

    expect(part("live")).toHaveAttribute("data-state", "refused");
    expect(part("live")).toHaveTextContent(
      "OneUptime could not reach the event hubs.",
    );
    expect(part("live")).toHaveTextContent("port 9093");
  });

  test("a connection that is turned off says its event hubs are not read", () => {
    openDialog(connection({ isEnabled: false }));

    expect(part("turned-off")).toHaveTextContent(
      "This connection is turned off, so its event hubs are not read. Turn it on to read them.",
    );
  });
});
