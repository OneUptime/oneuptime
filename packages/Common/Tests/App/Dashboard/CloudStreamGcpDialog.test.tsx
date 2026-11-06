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
 * Stream logs, on a Google Cloud connection's row in Cloud > Connect: the
 * dialog that sets Cloud Logging up to push a project's logs to OneUptime
 * through Pub/Sub, drawn for real - the option picker, the numbered steps,
 * the command, the fold - with the network stubbed:
 *
 *   - one question, which logs - warnings and errors at first, every log
 *     but the Data Access audit logs, or a filter of one's own - then
 *     three steps: make a stream key, run one command in Google Cloud
 *     Shell, wait for the first push;
 *   - the command makes the topic and its push service account in the
 *     project of the connection's own service account, and a sink in each
 *     project it reads; it waits for a key, holds it once made - the
 *     token's audience - and the list is told;
 *   - what stops a command being written - no project of its own, a
 *     project that is no ID, an empty filter, an address Pub/Sub will not
 *     push to - is said;
 *   - the last step asks every few seconds what arrived, in Google Cloud's
 *     words: waiting, which logs came from where, or why a push was
 *     refused;
 *   - the projects and the values for setting it up another way are under
 *     More fields.
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

import * as UIConfig from "../../../UI/Config";
import CloudStreamGcpDialog from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamGcpDialog";
import { CLOUD_STREAM_DIALOG_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamParts";
import {
  CLOUD_STREAM_POLL_MS,
  readCloudStreamKeyMade,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectApi";
import {
  GCP_STREAM_DOCS_PATH,
  getDefaultGcpStreamChoices,
  getGcpStreamDefaultProjects,
  getGcpStreamHostProject,
  getGcpStreamSetup,
  getGcpStreamStopCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamGcpSetup";
import {
  CloudStreamStatusWords,
  GCP_STREAM_REFUSAL_WORDS,
  GCP_STREAM_WAITING_SENTENCE,
  getCloudStreamRefusalWords,
  getCloudStreamSourceWords,
  getCloudStreamStatusWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamWords";
import { CloudTemplate } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionWords";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import Protocol from "../../../Types/API/Protocol";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudStreamRefusalReason } from "../../../Types/CloudConnection/CloudStream";
import {
  GCP_CLOUD_STREAM_EVERY_LOG_FILTER,
  GCP_CLOUD_STREAM_WARNINGS_FILTER,
  GcpCloudStreamLogs,
  STREAM_NO_FILTER,
  STREAM_NO_HOST_PROJECT,
  STREAM_NOT_A_PROJECT,
} from "../../../Types/CloudConnection/CloudStreamGcp";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const CONNECTION_ID: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const STREAM_KEY: string = `oucs_${CONNECTION_ID}_${"cd".repeat(32)}`;
const HOST_PROJECT: string = "acme-prod";
const PUSHER: string =
  "oneuptime-push-6f1c3a2e@acme-prod.iam.gserviceaccount.com";
const ENDPOINT: string =
  "https://oneuptime.example.com/telemetry/gcp-pubsub/v1/logs";
const NOW: Date = new Date("2026-11-06T10:00:00.000Z");

let postSpy: jest.SpyInstance<any, any>;
let getItemSpy: jest.SpyInstance<any, any>;

function connection(fields: Partial<CloudConnection> = {}): CloudConnection {
  const item: CloudConnection = new CloudConnection();
  item._id = CONNECTION_ID;
  item.name = "Google Cloud acme-prod";
  item.provider = CloudProvider.GCP;
  item.isEnabled = true;
  item.config = {
    authMethod: "gcp-service-account-key",
    clientEmail: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
    keyProjectId: HOST_PROJECT,
  };
  item.lastPullResult = {
    status: "success",
    accounts: [HOST_PROJECT, "acme-data"],
    regions: [{ region: "europe-west1", count: 3 }],
  };
  Object.assign(item, fields);
  return item;
}

function minutesAgo(minutes: number, from: Date = new Date()): string {
  return new Date(from.getTime() - minutes * 60 * 1000).toISOString();
}

function setProtocol(protocol: Protocol): void {
  (UIConfig as unknown as { HTTP_PROTOCOL: Protocol }).HTTP_PROTOCOL = protocol;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/connect`);
  setProtocol(Protocol.HTTPS);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  postSpy = getJestSpyOn(API, "post").mockResolvedValue({
    data: {
      streamKey: STREAM_KEY,
      createdAt: NOW.toISOString(),
      previousKeyWorksUntil: null,
      pushServiceAccount: PUSHER,
    },
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
    <CloudStreamGcpDialog
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

async function choose(logs: GcpCloudStreamLogs): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`setup-guide-option-${logs}`));
  });
}

async function type(name: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(part(name), { target: { value } });
  });
}

async function makeKey(): Promise<void> {
  await act(async () => {
    fireEvent.click(part("make-key"));
  });
}

async function openMoreFields(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(part("more-fields")).getByTestId("folded-section-header"),
    );
  });
}

describe("how a Google Cloud stream is said to be doing", () => {
  test("waiting, receiving, quiet and refused, in Google Cloud's words", () => {
    const waiting: CloudStreamStatusWords = getCloudStreamStatusWords({
      provider: CloudProvider.GCP,
      streamKeyCreatedAt: NOW,
      streamSummary: null,
      now: NOW,
    })!;

    expect(waiting.sentence).toEqual({
      template: GCP_STREAM_WAITING_SENTENCE,
      values: {},
    });
    expect(
      getCloudStreamStatusWords({
        provider: CloudProvider.GCP,
        streamKeyCreatedAt: NOW,
        streamSummary: { lastDeliveryAt: minutesAgo(1, NOW) },
        now: NOW,
      })!.sentence.template,
    ).toBe("Receiving. The last push came {{time}}.");
    // Quiet is no reason to read anything again: only logs stream.
    expect(
      getCloudStreamStatusWords({
        provider: CloudProvider.GCP,
        streamKeyCreatedAt: NOW,
        streamSummary: { lastDeliveryAt: minutesAgo(30, NOW) },
        now: NOW,
      })!.sentence.template,
    ).toBe(
      "No push since {{time}}: the projects wrote no log the filter takes, or their sinks are gone.",
    );

    const refused: CloudStreamStatusWords = getCloudStreamStatusWords({
      provider: CloudProvider.GCP,
      streamKeyCreatedAt: NOW,
      streamSummary: {
        lastRefusal: {
          reason: CloudStreamRefusalReason.WrongToken,
          at: minutesAgo(1, NOW),
        },
      },
      now: NOW,
    })!;

    expect(refused.label).toBe("Stream refused");
    expect(refused.sentence.template).toBe(
      "The last push was refused, {{time}}: {{reason}} {{advice}}",
    );
    expect(JSON.stringify(refused.sentence.values)).toContain(
      "A push was not signed by Google for this connection's push service account.",
    );
  });

  test("every reason a push is refused for says what happened and what to do", () => {
    for (const reason of [
      CloudStreamRefusalReason.WrongKey,
      CloudStreamRefusalReason.WrongToken,
      CloudStreamRefusalReason.TurnedOff,
      CloudStreamRefusalReason.NotAllowed,
      CloudStreamRefusalReason.TooLarge,
      CloudStreamRefusalReason.Malformed,
      CloudStreamRefusalReason.Throttled,
    ]) {
      const words: { reason: string; advice: string } =
        getCloudStreamRefusalWords({ provider: "gcp", reason });

      expect(words).toBe(GCP_STREAM_REFUSAL_WORDS[reason]);
      expect(words.reason.length).toBeGreaterThan(10);
      expect(words.advice.length).toBeGreaterThan(10);
      // Never Firehose's words.
      expect(`${words.reason} ${words.advice}`).not.toContain("Firehose");
    }
  });

  test("what arrived: the logs, a line a place, always with their project", () => {
    const at: string = minutesAgo(1, NOW);
    const lines: Array<CloudTemplate> = getCloudStreamSourceWords(
      {
        metricSources: [],
        logSources: [
          {
            accountId: HOST_PROJECT,
            region: "us-central1",
            logGroups: [
              "run.googleapis.com/requests",
              "run.googleapis.com/stderr",
            ],
            lastAt: at,
          },
          {
            accountId: "acme-data",
            region: "",
            logGroups: ["cloudaudit.googleapis.com/activity"],
            lastAt: at,
          },
        ],
      },
      CloudProvider.GCP,
    );

    expect(lines).toEqual([
      {
        template: "Entries of {{count}} logs from {{region}}",
        values: { region: `us-central1 (${HOST_PROJECT})` },
        plural: { one: "Entries of {{count}} log from {{region}}", count: 2 },
      },
      {
        template: "Entries of {{count}} logs from {{region}}",
        // A log of no region is its project's.
        values: { region: "acme-data" },
        plural: { one: "Entries of {{count}} log from {{region}}", count: 1 },
      },
    ]);
  });

  test("the key the server answers says the service account its pushes must be signed as", () => {
    expect(
      readCloudStreamKeyMade({
        streamKey: STREAM_KEY,
        createdAt: NOW.toISOString(),
        pushServiceAccount: PUSHER,
      }).pushServiceAccount,
    ).toBe(PUSHER);
    expect(
      readCloudStreamKeyMade({ streamKey: STREAM_KEY, pushServiceAccount: 5 })
        .pushServiceAccount,
    ).toBeNull();
  });
});

describe("the projects it streams from", () => {
  test("the topic goes in the project of the connection's own service account", () => {
    expect(
      getGcpStreamHostProject({ config: { keyProjectId: " Acme-Prod " } }),
    ).toBe("acme-prod");
    expect(getGcpStreamHostProject({ config: {} })).toBe("");
  });

  test("the projects it is set to read, else the ones its last read reached, else its own", () => {
    expect(
      getGcpStreamDefaultProjects({
        config: {
          projectIds: "acme-web, ACME-DATA",
          keyProjectId: HOST_PROJECT,
        },
        lastPullResult: { accounts: [HOST_PROJECT] },
      }),
    ).toEqual(["acme-web", "acme-data"]);
    expect(
      getGcpStreamDefaultProjects({
        config: { keyProjectId: HOST_PROJECT },
        lastPullResult: { accounts: ["acme-data", "Not a project!"] },
      }),
    ).toEqual(["acme-data"]);
    expect(
      getGcpStreamDefaultProjects({ config: { keyProjectId: HOST_PROJECT } }),
    ).toEqual([HOST_PROJECT]);
    expect(getGcpStreamDefaultProjects({})).toEqual([]);
  });

  test("each choice of logs is its filter; what stops a command is said", () => {
    type Setup = ReturnType<typeof getGcpStreamSetup>;
    type Choices = ReturnType<typeof getDefaultGcpStreamChoices>;
    const setup: (
      changes: Partial<Choices>,
      hostProjectId?: string,
    ) => Setup = (
      changes: Partial<Choices>,
      hostProjectId: string = HOST_PROJECT,
    ): Setup => {
      return getGcpStreamSetup({
        choices: { ...getDefaultGcpStreamChoices([HOST_PROJECT]), ...changes },
        connectionId: CONNECTION_ID,
        hostProjectId,
        oneuptimeUrl: "https://oneuptime.example.com",
      });
    };

    expect(setup({}).filter).toBe(GCP_CLOUD_STREAM_WARNINGS_FILTER);
    expect(setup({ logs: GcpCloudStreamLogs.Every }).filter).toBe(
      GCP_CLOUD_STREAM_EVERY_LOG_FILTER,
    );
    expect(
      setup({
        logs: GcpCloudStreamLogs.Custom,
        customFilter: " severity=ERROR ",
      }).filter,
    ).toBe("severity=ERROR");
    expect(setup({}).endpoint).toBe(ENDPOINT);
    expect(setup({}).pushServiceAccount).toBe(PUSHER);
    expect(setup({}).problem).toBeNull();

    expect(setup({}, "").problem?.text).toBe(STREAM_NO_HOST_PROJECT);
    expect(setup({ projectsText: "Not a project!" }).problem?.text).toBe(
      STREAM_NOT_A_PROJECT,
    );
    expect(
      setup({ logs: GcpCloudStreamLogs.Custom, customFilter: "  " }).problem
        ?.text,
    ).toBe(STREAM_NO_FILTER);
  });

  test("Stop streaming's command deletes the sinks of the projects it reads, then the topic in its own", () => {
    const text: string = getGcpStreamStopCommand({
      connectionId: CONNECTION_ID,
      config: { keyProjectId: HOST_PROJECT },
      lastPullResult: { accounts: [HOST_PROJECT, "acme-data"] },
    });

    expect(text).toContain(`for SOURCE in '${HOST_PROJECT}' 'acme-data'; do`);
    expect(text).toContain(
      `gcloud pubsub topics delete oneuptime-stream-6f1c3a2e --project '${HOST_PROJECT}' --quiet`,
    );
    expect(text).toContain(`gcloud iam service-accounts delete '${PUSHER}'`);
  });
});

describe("the dialog", () => {
  test("asks which logs, then three steps, and the command waits for a key", () => {
    openDialog();

    expect(screen.getByRole("dialog")).toHaveTextContent("Stream logs");
    // Logs only: metrics stay on the read's schedule.
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Metrics are still read on the connection's schedule.",
    );
    expect(screen.getByTestId(CLOUD_STREAM_DIALOG_TEST_ID)).toHaveAttribute(
      "data-provider",
      "gcp",
    );

    const question: HTMLElement = part("question");

    expect(question).toHaveTextContent("Which logs should it stream?");
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
      ["setup-guide-option-warnings-and-errors", "true"],
      ["setup-guide-option-every", "false"],
      ["setup-guide-option-custom", "false"],
    ]);
    expect(queryPart("filter")).not.toBeInTheDocument();

    const steps: Array<HTMLElement> = [1, 2, 3].map((index: number) => {
      return screen.getByTestId(`setup-guide-step-${index}`);
    });

    expect(steps[0]).toHaveTextContent("Make a stream key");
    expect(steps[0]).toHaveTextContent(
      "Pub/Sub sends this key with every push, as the audience of the token it signs.",
    );
    expect(steps[1]).toHaveTextContent("Run this in Google Cloud Shell");
    expect(steps[2]).toHaveTextContent("Wait for the first push");

    expect(command()).toContain(`local PROJECT='${HOST_PROJECT}'`);
    expect(command()).toContain(`local PUSHER='${PUSHER}'`);
    expect(command()).toContain(`local ENDPOINT='${ENDPOINT}'`);
    expect(command()).toContain(
      `local FILTER='${GCP_CLOUD_STREAM_WARNINGS_FILTER}'`,
    );
    expect(command()).toContain(
      `for SOURCE in '${HOST_PROJECT}' 'acme-data'; do`,
    );
    expect(command()).toContain("local STREAM_KEY='<YOUR_STREAM_KEY>'");
    expect(part("needs-key")).toHaveTextContent(
      "Make a key in the first step: the command holds it in place of <YOUR_STREAM_KEY>.",
    );
    expect(part("open-shell")).toHaveAttribute(
      "href",
      "https://shell.cloud.google.com/?show=terminal",
    );
    expect(part("what-it-makes")).toHaveTextContent(HOST_PROJECT);
    expect(part("what-it-makes")).toHaveTextContent(
      "oneuptime-stream-6f1c3a2e",
    );
    expect(part("live")).toHaveAttribute("data-state", "no-key");
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("making a key puts it in the command as the token's audience, shows it this once, and tells the list", async () => {
    const onChanged: MockFunction = getJestMockFunction();
    openDialog(connection(), onChanged);

    await makeKey();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]![0].url.toString()).toMatch(
      new RegExp(`/cloud-connection/${CONNECTION_ID}/stream-key$`),
    );
    expect(command()).toContain(`local STREAM_KEY='${STREAM_KEY}'`);
    expect(command()).toContain('--push-auth-token-audience "$STREAM_KEY"');
    expect(part("key-made")).toHaveTextContent("Key made.");
    expect(queryPart("needs-key")).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(part("live")).toHaveAttribute("data-state", "waiting");
    expect(part("live")).toHaveTextContent(
      "Waiting for the first push. Pub/Sub pushes a log within a minute of a project writing one the filter takes.",
    );

    await openMoreFields();

    expect(part("push-endpoint")).toHaveTextContent(ENDPOINT);
    expect(part("push-service-account")).toHaveTextContent(PUSHER);
    expect(part("audience")).toHaveTextContent(STREAM_KEY);
  });

  test("a connection that streams already makes a new key to run the command again", async () => {
    const madeAt: Date = new Date("2026-11-01T09:00:00.000Z");
    openDialog(connection({ streamKeyCreatedAt: madeAt }));

    expect(part("key")).toHaveTextContent(
      `This connection has a stream key, made ${OneUptimeDate.getDateAsLocalShortDateTimeString(madeAt)}.`,
    );
    expect(part("make-key")).toHaveTextContent("Make a new key");
    expect(command()).toContain("<YOUR_STREAM_KEY>");
  });

  test("every log, or a filter of one's own, is the sinks' filter", async () => {
    openDialog();

    await choose(GcpCloudStreamLogs.Every);

    expect(command()).toContain(
      `local FILTER='NOT log_id("cloudaudit.googleapis.com/data_access")'`,
    );

    await choose(GcpCloudStreamLogs.Custom);

    // No filter yet: no command, and why.
    expect(part("problem")).toHaveTextContent(
      "Write the filter, in the Cloud Logging query language.",
    );
    expect(queryPart("command")).not.toBeInTheDocument();

    await type(
      "filter",
      'resource.type="cloud_run_revision" AND severity>=ERROR',
    );

    expect(command()).toContain(
      `local FILTER='resource.type="cloud_run_revision" AND severity>=ERROR'`,
    );
  });

  test("a connection that says no project of its own gets no command", () => {
    openDialog(
      connection({ config: { authMethod: "gcp-service-account-key" } }),
    );

    expect(part("problem")).toHaveTextContent(
      "This connection does not say which project its service account is from.",
    );
    expect(queryPart("command")).not.toBeInTheDocument();
  });

  test("More fields holds the projects, and the values to set it up another way", async () => {
    openDialog();

    expect(part("more-fields")).toHaveTextContent("Projects: 2");

    await openMoreFields();

    expect(part("projects")).toHaveValue(`${HOST_PROJECT}, acme-data`);
    // Before a key, the push service account is still known: it is the connection's.
    expect(part("push-service-account")).toHaveTextContent(PUSHER);
    expect(queryPart("audience")).not.toBeInTheDocument();
    expect(part("guide").getAttribute("href")).toContain(
      GCP_STREAM_DOCS_PATH.slice("/docs".length),
    );

    await type("projects", "acme-web");

    expect(command()).toContain("for SOURCE in 'acme-web'; do");
    // The topic stays in the connection's own project.
    expect(command()).toContain(`local PROJECT='${HOST_PROJECT}'`);

    await type("projects", "Not a project!");

    expect(part("problem")).toHaveTextContent(
      "List projects by their IDs, such as my-project-123456.",
    );
  });

  test("the last step asks every few seconds what arrived, and says it, with where it came from", async () => {
    jest.useFakeTimers();
    const lastDeliveryAt: string = minutesAgo(1);
    getItemSpy.mockResolvedValue(
      connection({
        streamKeyCreatedAt: new Date(minutesAgo(30)),
        streamSummary: {
          lastDeliveryAt,
          metricSources: [],
          logSources: [
            {
              accountId: HOST_PROJECT,
              region: "europe-west1",
              logGroups: ["run.googleapis.com/requests"],
              lastAt: lastDeliveryAt,
            },
          ],
        },
      }),
    );
    openDialog(connection({ streamKeyCreatedAt: new Date(minutesAgo(30)) }));

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
      `Receiving. The last push came ${OneUptimeDate.getDateAsLocalShortDateTimeString(new Date(lastDeliveryAt))}.`,
    );
    expect(part("sources")).toHaveTextContent(
      `Entries of 1 log from europe-west1 (${HOST_PROJECT})`,
    );
  });

  test("a refused push says why, and what to do", () => {
    openDialog(
      connection({
        streamKeyCreatedAt: new Date(minutesAgo(30)),
        streamSummary: {
          lastRefusal: {
            reason: CloudStreamRefusalReason.WrongKey,
            at: minutesAgo(2),
          },
        },
      }),
    );

    expect(part("live")).toHaveAttribute("data-state", "refused");
    expect(part("live")).toHaveTextContent(
      "A push came with a key that is not this connection's.",
    );
    expect(part("live")).toHaveTextContent(
      "Pub/Sub keeps the messages it could not push for a day",
    );
  });

  test("a connection that is turned off says what Pub/Sub pushes is refused", () => {
    openDialog(connection({ isEnabled: false }));

    expect(part("turned-off")).toHaveTextContent(
      "This connection is turned off, so what Pub/Sub pushes is refused. Turn it on to take it.",
    );
  });

  test("a OneUptime not served over HTTPS cannot be pushed to, and says so", () => {
    setProtocol(Protocol.HTTP);
    openDialog();

    expect(part("problem")).toHaveTextContent(
      "Pub/Sub pushes to https:// addresses only, and this OneUptime is not served over HTTPS.",
    );
    expect(queryPart("command")).not.toBeInTheDocument();
    // The key can still be made: the problem is the address, not the key.
    expect(part("make-key")).toBeEnabled();
  });
});
