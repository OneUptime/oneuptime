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
 * Stream metrics and logs, on an AWS connection's row in Cloud > Connect:
 * the dialog that sets Amazon Data Firehose up to deliver the account's
 * CloudWatch metrics and logs, drawn for real - the option picker, the
 * numbered steps, the command, the fold - with the network stubbed:
 *
 *   - one question, what to stream, then three steps: make a stream key,
 *     run one command in AWS CloudShell, wait for the first delivery;
 *   - the command waits for a key and holds it once made - the key is
 *     shown this once - and the list is told to read its rows again;
 *   - a connection that streams already makes a new key to run the
 *     command again, and is told how long the key it replaces works;
 *   - logs: the log groups named, in the Region beside, or every one;
 *     what is wrong with the choices stops the command and says so;
 *   - the Regions, every metric and the values for another way are under
 *     More fields;
 *   - the last step asks every few seconds what arrived: waiting, what
 *     arrived from where, or why a delivery was refused - and stops asking
 *     once the dialog is closed;
 *   - a OneUptime not served over HTTPS cannot stream, and says so.
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
import CloudStreamDialog, {
  CLOUD_STREAM_DIALOG_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamDialog";
import {
  CLOUD_STREAM_POLL_MS,
  readCloudStreamKeyMade,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectApi";
import {
  CLOUD_STREAM_FALLBACK_REGION,
  CloudStreamChoices,
  CloudStreamSetup,
  CloudStreamWhat,
  NOT_HTTPS_PROBLEM,
  getCloudStreamSetup,
  getDefaultCloudStreamChoices,
  streamsLogs,
  streamsMetrics,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamSetup";
import {
  CLOUD_STREAM_REFUSAL_WORDS,
  CloudStreamStatusWords,
  STREAM_QUIET_SENTENCE,
  STREAM_RECEIVING_SENTENCE,
  STREAM_REFUSED_SENTENCE,
  STREAM_WAITING_SENTENCE,
  getCloudStreamDefaultRegions,
  getCloudStreamSourceWords,
  getCloudStreamStackRegions,
  getCloudStreamStatusWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamWords";
import { CloudTemplate } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionWords";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import Protocol from "../../../Types/API/Protocol";
import { Gray500, Green, Red, Yellow } from "../../../Types/BrandColors";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudStreamRefusalReason } from "../../../Types/CloudConnection/CloudStream";
import {
  CloudStreamLogsMode,
  CloudStreamMetricsMode,
  STREAM_NOT_A_REGION,
  STREAM_NO_LOG_GROUP,
} from "../../../Types/CloudConnection/CloudStreamTemplate";
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
const STREAM_KEY: string = `oucs_${CONNECTION_ID}_${"ab".repeat(32)}`;
const ONEUPTIME: string = "https://oneuptime.example.com";
const METRICS_URL: string = `${ONEUPTIME}/telemetry/aws-firehose/v1/metrics`;
const LOGS_URL: string = `${ONEUPTIME}/telemetry/aws-firehose/v1/logs`;
const NOW: Date = new Date("2026-11-04T10:00:00.000Z");

let postSpy: jest.SpyInstance<any, any>;
let getItemSpy: jest.SpyInstance<any, any>;

function connection(fields: Partial<CloudConnection> = {}): CloudConnection {
  const item: CloudConnection = new CloudConnection();
  item._id = CONNECTION_ID;
  item.name = "Production AWS";
  item.provider = CloudProvider.AWS;
  item.isEnabled = true;
  item.lastPullResult = {
    status: "success",
    regions: [
      { region: "us-east-1", count: 12 },
      { region: "eu-west-1", count: 3 },
    ],
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
  onClose: MockFunction = getJestMockFunction(),
): void {
  render(
    <CloudStreamDialog
      connection={item}
      onClose={onClose}
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

async function makeKey(): Promise<void> {
  await act(async () => {
    fireEvent.click(part("make-key"));
  });
}

async function choose(what: CloudStreamWhat): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`setup-guide-option-${what}`));
  });
}

async function type(name: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(part(name), { target: { value } });
  });
}

async function openMoreFields(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(part("more-fields")).getByTestId("folded-section-header"),
    );
  });
}

describe("how streaming is said to be doing", () => {
  test("nothing while the connection has no key, whatever arrived before", () => {
    expect(
      getCloudStreamStatusWords({
        streamKeyCreatedAt: null,
        streamSummary: { lastDeliveryAt: minutesAgo(1, NOW) },
        now: NOW,
      }),
    ).toBeNull();
  });

  test("waiting for the first delivery, then receiving, then quiet", () => {
    const waiting: CloudStreamStatusWords = getCloudStreamStatusWords({
      streamKeyCreatedAt: NOW,
      streamSummary: null,
      now: NOW,
    })!;

    expect(waiting).toEqual({
      state: "waiting",
      label: "Stream waiting",
      color: Yellow,
      sentence: { template: STREAM_WAITING_SENTENCE, values: {} },
    });

    const lastDeliveryAt: string = minutesAgo(2, NOW);
    const receiving: CloudStreamStatusWords = getCloudStreamStatusWords({
      streamKeyCreatedAt: NOW,
      streamSummary: { lastDeliveryAt },
      now: NOW,
    })!;

    expect(receiving.state).toBe("receiving");
    expect(receiving.label).toBe("Streaming");
    expect(receiving.color).toBe(Green);
    expect(receiving.sentence).toEqual({
      template: STREAM_RECEIVING_SENTENCE,
      values: {
        time: OneUptimeDate.getDateAsLocalShortDateTimeString(
          new Date(lastDeliveryAt),
        ),
      },
    });

    const quiet: CloudStreamStatusWords = getCloudStreamStatusWords({
      streamKeyCreatedAt: NOW,
      streamSummary: { lastDeliveryAt: minutesAgo(20, NOW) },
      now: NOW,
    })!;

    expect(quiet.state).toBe("quiet");
    expect(quiet.label).toBe("Stream quiet");
    expect(quiet.color).toBe(Gray500);
    expect(quiet.sentence.template).toBe(STREAM_QUIET_SENTENCE);
  });

  test("refused, with why and what to do, while the refusal is the newest word", () => {
    const refused: CloudStreamStatusWords = getCloudStreamStatusWords({
      streamKeyCreatedAt: NOW,
      streamSummary: {
        lastDeliveryAt: minutesAgo(10, NOW),
        lastRefusal: {
          reason: CloudStreamRefusalReason.WrongKey,
          at: minutesAgo(1, NOW),
        },
      },
      now: NOW,
    })!;

    expect(refused.state).toBe("refused");
    expect(refused.label).toBe("Stream refused");
    expect(refused.color).toBe(Red);
    expect(refused.sentence.template).toBe(STREAM_REFUSED_SENTENCE);
    expect(JSON.stringify(refused.sentence.values)).toContain(
      CLOUD_STREAM_REFUSAL_WORDS[CloudStreamRefusalReason.WrongKey].reason,
    );
    expect(JSON.stringify(refused.sentence.values)).toContain(
      CLOUD_STREAM_REFUSAL_WORDS[CloudStreamRefusalReason.WrongKey].advice,
    );

    // A delivery taken after it: receiving again.
    expect(
      getCloudStreamStatusWords({
        streamKeyCreatedAt: NOW,
        streamSummary: {
          lastDeliveryAt: minutesAgo(0.5, NOW),
          lastRefusal: {
            reason: CloudStreamRefusalReason.WrongKey,
            at: minutesAgo(1, NOW),
          },
        },
        now: NOW,
      })!.state,
    ).toBe("receiving");
  });

  test("every reason a delivery is refused for says what happened and what to do", () => {
    for (const reason of Object.values(CloudStreamRefusalReason)) {
      expect(CLOUD_STREAM_REFUSAL_WORDS[reason].reason.length).toBeGreaterThan(
        10,
      );
      expect(CLOUD_STREAM_REFUSAL_WORDS[reason].advice.length).toBeGreaterThan(
        10,
      );
    }
  });
});

describe("what arrived, from where", () => {
  test("a line a Region and kind, counted, and the account once there are several", () => {
    const one: Array<CloudTemplate> = getCloudStreamSourceWords({
      metricSources: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          namespaces: ["AWS/EC2", "AWS/RDS", "AWS/Lambda"],
          lastAt: minutesAgo(1, NOW),
        },
      ],
      logSources: [
        {
          accountId: "123456789012",
          region: "eu-west-1",
          logGroups: ["/aws/lambda/checkout"],
          lastAt: minutesAgo(1, NOW),
        },
      ],
    });

    expect(one).toEqual([
      {
        template: "Metrics of {{count}} namespaces from {{region}}",
        values: { region: "us-east-1" },
        plural: {
          one: "Metrics of {{count}} namespace from {{region}}",
          count: 3,
        },
      },
      {
        template: "Logs of {{count}} log groups from {{region}}",
        values: { region: "eu-west-1" },
        plural: {
          one: "Logs of {{count}} log group from {{region}}",
          count: 1,
        },
      },
    ]);

    const two: Array<CloudTemplate> = getCloudStreamSourceWords({
      metricSources: [
        {
          accountId: "123456789012",
          region: "us-east-1",
          namespaces: ["AWS/EC2"],
          lastAt: minutesAgo(1, NOW),
        },
        {
          accountId: "210987654321",
          region: "us-east-1",
          namespaces: ["AWS/EC2"],
          lastAt: minutesAgo(1, NOW),
        },
      ],
      logSources: [],
    });

    expect(
      two.map((line: CloudTemplate) => {
        return line.values["region"];
      }),
    ).toEqual(["us-east-1 (123456789012)", "us-east-1 (210987654321)"]);
    expect(getCloudStreamSourceWords(null)).toEqual([]);
  });

  test("the Regions a connection's last read found resources in, each once, as AWS writes them", () => {
    expect(
      getCloudStreamDefaultRegions({
        regions: [
          { region: "us-east-1", count: 5 },
          { region: " EU-WEST-1 ", count: 2 },
          { region: "us-east-1", count: 1 },
          { count: 3 },
          "us-west-2",
          null,
        ],
      }),
    ).toEqual(["us-east-1", "eu-west-1"]);

    for (const value of [undefined, null, "x", { regions: "us-east-1" }]) {
      expect(getCloudStreamDefaultRegions(value)).toEqual([]);
    }
  });

  test("the Regions a connection's stacks are in: where its streams delivered from, then where its read found resources", () => {
    const at: string = new Date(NOW.getTime() - 60 * 1000).toISOString();

    expect(
      getCloudStreamStackRegions({
        streamSummary: {
          lastDeliveryAt: at,
          metricSources: [
            {
              accountId: "123456789012",
              region: "ap-southeast-2",
              namespaces: ["AWS/EC2"],
              lastAt: at,
            },
          ],
          logSources: [
            {
              accountId: "123456789012",
              region: "EU-WEST-1",
              logGroups: ["/aws/lambda/checkout"],
              lastAt: at,
            },
            {
              accountId: "123456789012",
              region: "not a region",
              logGroups: ["/aws/lambda/refunds"],
              lastAt: at,
            },
          ],
        },
        lastPullResult: {
          regions: [
            { region: "us-east-1", count: 5 },
            { region: "eu-west-1", count: 2 },
          ],
        },
      }),
    ).toEqual(["ap-southeast-2", "eu-west-1", "us-east-1"]);

    // Nothing delivered yet: the read's Regions, as the command's were.
    expect(
      getCloudStreamStackRegions({
        streamSummary: null,
        lastPullResult: { regions: [{ region: "us-east-1", count: 5 }] },
      }),
    ).toEqual(["us-east-1"]);
    expect(
      getCloudStreamStackRegions({ streamSummary: null, lastPullResult: null }),
    ).toEqual([]);
  });
});

describe("what the choices make", () => {
  function setup(changes: Partial<CloudStreamChoices> = {}): CloudStreamSetup {
    return getCloudStreamSetup({
      choices: {
        ...getDefaultCloudStreamChoices(["us-east-1", "eu-west-1"]),
        ...changes,
      },
      connectionId: CONNECTION_ID,
      oneuptimeUrl: `${ONEUPTIME}/`,
    });
  }

  test("by default: every key metric, from the Regions the connection found resources in", () => {
    expect(getDefaultCloudStreamChoices(["us-east-1", "eu-west-1"])).toEqual({
      what: CloudStreamWhat.Metrics,
      logGroupsText: "",
      logGroupsRegion: "us-east-1",
      everyLogGroup: false,
      everyMetric: false,
      regionsText: "us-east-1, eu-west-1",
    });
    expect(getDefaultCloudStreamChoices([]).logGroupsRegion).toBe(
      CLOUD_STREAM_FALLBACK_REGION,
    );

    const made: CloudStreamSetup = setup();

    expect(made.problem).toBeNull();
    expect(made.regions).toEqual(["us-east-1", "eu-west-1"]);
    expect(made.metricsUrl).toBe(METRICS_URL);
    expect(made.logsUrl).toBe(LOGS_URL);
    expect(made.options).toEqual({
      connectionId: CONNECTION_ID,
      metricsUrl: METRICS_URL,
      logsUrl: LOGS_URL,
      metrics: CloudStreamMetricsMode.Key,
      logs: CloudStreamLogsMode.Off,
      logGroups: [],
    });
  });

  test("what to stream picks the metric and log modes", () => {
    expect(streamsMetrics(CloudStreamWhat.Metrics)).toBe(true);
    expect(streamsLogs(CloudStreamWhat.Metrics)).toBe(false);
    expect(streamsMetrics(CloudStreamWhat.Logs)).toBe(false);
    expect(streamsLogs(CloudStreamWhat.Logs)).toBe(true);

    expect(setup({ everyMetric: true }).options.metrics).toBe(
      CloudStreamMetricsMode.All,
    );

    const logsOnly: CloudStreamSetup = setup({
      what: CloudStreamWhat.Logs,
      everyLogGroup: true,
      // Not offered for logs alone: every metric is left out with metrics.
      everyMetric: true,
    });

    expect(logsOnly.options.metrics).toBe(CloudStreamMetricsMode.Off);
    expect(logsOnly.options.logs).toBe(CloudStreamLogsMode.All);
    expect(logsOnly.options.logGroups).toEqual([]);
  });

  test("named log groups: a name in the Region beside, an ARN in its own, Regions written as AWS writes them", () => {
    const made: CloudStreamSetup = setup({
      what: CloudStreamWhat.MetricsAndLogs,
      logGroupsText:
        "/aws/lambda/checkout\narn:aws:logs:ap-south-1:123456789012:log-group:/aws/rds/instance/orders/error:*",
      logGroupsRegion: "eu-west-1",
      regionsText: "US-EAST-1",
    });

    expect(made.problem).toBeNull();
    expect(made.regions).toEqual(["us-east-1"]);
    expect(made.options.logs).toBe(CloudStreamLogsMode.Groups);
    expect(made.logGroups).toEqual([
      { name: "/aws/lambda/checkout", region: "eu-west-1" },
      { name: "/aws/rds/instance/orders/error", region: "ap-south-1" },
    ]);
  });

  test("what stops a command being written, as words of the dialog with their values", () => {
    expect(setup({ what: CloudStreamWhat.MetricsAndLogs }).problem).toEqual({
      text: STREAM_NO_LOG_GROUP,
      values: {},
    });
    expect(setup({ regionsText: "us-east-1, moon-1" }).problem).toEqual({
      text: STREAM_NOT_A_REGION,
      values: {},
    });

    // Firehose delivers to https:// only.
    expect(
      getCloudStreamSetup({
        choices: getDefaultCloudStreamChoices(["us-east-1"]),
        connectionId: CONNECTION_ID,
        oneuptimeUrl: "http://oneuptime.local",
      }).problem,
    ).toEqual({ text: NOT_HTTPS_PROBLEM, values: {} });
  });
});

describe("the key the server answers", () => {
  test("is read as the key it is, with its times", () => {
    expect(
      readCloudStreamKeyMade({
        streamKey: STREAM_KEY,
        createdAt: NOW.toISOString(),
        previousKeyWorksUntil: "2026-11-05T10:00:00.000Z",
      }),
    ).toEqual({
      streamKey: STREAM_KEY,
      createdAt: NOW,
      previousKeyWorksUntil: new Date("2026-11-05T10:00:00.000Z"),
    });

    const made: { previousKeyWorksUntil: Date | null } = readCloudStreamKeyMade(
      {
        streamKey: STREAM_KEY,
        createdAt: "never",
        previousKeyWorksUntil: "never",
      },
    );

    expect(made.previousKeyWorksUntil).toBeNull();
  });

  test("an answer without a key is a failure, never an empty key", () => {
    for (const data of [undefined, {}, { streamKey: "" }, { streamKey: 5 }]) {
      expect(() => {
        readCloudStreamKeyMade(data as JSONObject | undefined);
      }).toThrow("The server did not return a stream key. Try again.");
    }
  });
});

describe("the dialog", () => {
  test("asks what to stream, then three steps, and the command waits for a key", () => {
    openDialog();

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Stream metrics and logs",
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
    // Logs are a choice away.
    expect(queryPart("logs")).not.toBeInTheDocument();

    const steps: Array<HTMLElement> = [1, 2, 3].map((index: number) => {
      return screen.getByTestId(`setup-guide-step-${index}`);
    });

    expect(steps[0]).toHaveTextContent("Make a stream key");
    expect(steps[1]).toHaveTextContent("Run this in AWS CloudShell");
    expect(steps[1]).toHaveTextContent(
      "Run it as someone who may create CloudFormation stacks and IAM roles in this account.",
    );
    expect(steps[2]).toHaveTextContent("Wait for the first delivery");

    // The command: the template, then a stack in each Region the read found.
    expect(command()).toContain("cat > oneuptime-stream.json <<'TEMPLATE'");
    expect(command()).toContain("for REGION in us-east-1 eu-west-1; do");
    expect(command()).toContain("STREAM_KEY='<YOUR_STREAM_KEY>'");
    expect(command()).toContain(METRICS_URL);
    expect(command()).toContain("AWS::CloudWatch::MetricStream");
    expect(command()).toContain("IncludeFilters");
    expect(command()).not.toContain("AWS::Logs::SubscriptionFilter");
    expect(part("needs-key")).toHaveTextContent(
      "Make a key in the first step: the command holds it in place of <YOUR_STREAM_KEY>.",
    );
    expect(part("open-shell")).toHaveAttribute(
      "href",
      "https://console.aws.amazon.com/cloudshell/home",
    );
    expect(part("what-it-makes")).toHaveTextContent("OneUptimeStream-6f1c3a2e");
    expect(part("live")).toHaveAttribute("data-state", "no-key");
    // Nothing asked of the server until a key is wanted.
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("making a key puts it in the command, shows it this once, and tells the list", async () => {
    const onChanged: MockFunction = getJestMockFunction();
    openDialog(connection(), onChanged);

    await makeKey();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]![0].url.toString()).toMatch(
      new RegExp(`/cloud-connection/${CONNECTION_ID}/stream-key$`),
    );
    expect(command()).toContain(`STREAM_KEY='${STREAM_KEY}'`);
    expect(command()).not.toContain("<YOUR_STREAM_KEY>");
    expect(part("key-made")).toHaveTextContent(
      "Key made. The command below holds it, and it is shown only here: run the command before you close this dialog.",
    );
    // A first key replaces none.
    expect(queryPart("previous-key")).not.toBeInTheDocument();
    expect(queryPart("needs-key")).not.toBeInTheDocument();
    expect(queryPart("make-key")).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The connection now has a key: the last step waits for a delivery.
    expect(part("live")).toHaveAttribute("data-state", "waiting");

    // For another way: the endpoints, and the key.
    await openMoreFields();

    expect(part("metrics-url")).toHaveTextContent(METRICS_URL);
    expect(part("logs-url")).toHaveTextContent(LOGS_URL);
    expect(part("access-key")).toHaveTextContent(STREAM_KEY);
  });

  test("a connection that streams already makes a new key, and hears how long the old one works", async () => {
    const madeAt: Date = new Date("2026-11-01T09:00:00.000Z");
    const worksUntil: string = "2026-11-05T10:00:00.000Z";
    postSpy.mockResolvedValue({
      data: {
        streamKey: STREAM_KEY,
        createdAt: NOW.toISOString(),
        previousKeyWorksUntil: worksUntil,
      },
    });
    openDialog(connection({ streamKeyCreatedAt: madeAt }));

    expect(part("key")).toHaveTextContent(
      `This connection has a stream key, made ${OneUptimeDate.getDateAsLocalShortDateTimeString(madeAt)}. It cannot be shown again: to run the command again, make a new key.`,
    );
    expect(part("make-key")).toHaveTextContent("Make a new key");
    // Its key cannot be shown: the command still waits for one.
    expect(command()).toContain("<YOUR_STREAM_KEY>");
    expect(part("live")).toHaveAttribute("data-state", "waiting");

    await makeKey();

    expect(part("previous-key")).toHaveTextContent(
      `The key it replaces keeps working until ${OneUptimeDate.getDateAsLocalShortDateTimeString(new Date(worksUntil))}.`,
    );
    expect(command()).toContain(STREAM_KEY);
  });

  test("a key the server would not make says why, and the command keeps waiting", async () => {
    postSpy.mockRejectedValue(
      new Error("Project owners and project administrators can connect."),
    );
    const onChanged: MockFunction = getJestMockFunction();
    openDialog(connection(), onChanged);

    await makeKey();

    expect(part("key-error")).toHaveTextContent(
      "Project owners and project administrators can connect.",
    );
    expect(part("key-error")).toHaveAttribute("role", "alert");
    expect(command()).toContain("<YOUR_STREAM_KEY>");
    expect(onChanged).not.toHaveBeenCalled();
    // It can be tried again.
    expect(part("make-key")).toBeEnabled();
  });

  test("metrics and logs: the log groups named go in the template, in the Region beside", async () => {
    openDialog();

    await choose(CloudStreamWhat.MetricsAndLogs);

    expect(part("logs")).toBeInTheDocument();
    expect(part("log-groups-region")).toHaveValue("us-east-1");
    // None named yet: no command, and why.
    expect(queryPart("command")).not.toBeInTheDocument();
    expect(queryPart("download")).not.toBeInTheDocument();
    expect(part("problem")).toHaveTextContent("Name at least one log group.");

    await type("log-groups", "/aws/lambda/checkout");

    expect(queryPart("problem")).not.toBeInTheDocument();
    expect(command()).toContain("/aws/lambda/checkout");
    expect(command()).toContain("AWS::Logs::SubscriptionFilter");
    expect(command()).toContain("AWS::CloudWatch::MetricStream");
    expect(command()).toContain(LOGS_URL);

    await type("log-groups", "not a log group!");

    expect(part("problem")).toHaveTextContent(
      "A log group's name has letters, digits and _ - / . # only.",
    );
  });

  test("every log group of the account needs no list, and logs alone leave metrics to the reads", async () => {
    openDialog();

    await choose(CloudStreamWhat.Logs);
    await act(async () => {
      fireEvent.click(part("every-log-group"));
    });

    expect(queryPart("log-groups")).not.toBeInTheDocument();
    expect(command()).toContain("AWS::Logs::AccountPolicy");
    expect(command()).toContain("SUBSCRIPTION_FILTER_POLICY");
    expect(command()).not.toContain("AWS::CloudWatch::MetricStream");

    // Every metric is a metrics choice: not offered for logs alone.
    await openMoreFields();
    expect(queryPart("every-metric")).not.toBeInTheDocument();
  });

  test("More fields holds every metric and the Regions; a Region AWS does not have stops the command", async () => {
    openDialog();

    const fold: HTMLElement = part("more-fields");

    // Folded, it says what it holds and what of it is in force.
    expect(fold).toHaveTextContent("More fields");
    expect(fold).toHaveTextContent("Every metric");
    expect(fold).toHaveTextContent("Regions: 2");
    expect(fold).toHaveTextContent("Set it up another way");

    await openMoreFields();

    expect(part("regions")).toHaveValue("us-east-1, eu-west-1");

    await type("regions", "us-east-1, moon-1");

    expect(part("problem")).toHaveTextContent(
      "List Regions by their codes, such as us-east-1 or eu-central-1.",
    );
    expect(queryPart("command")).not.toBeInTheDocument();

    await type("regions", "ap-south-1");

    expect(command()).toContain("for REGION in ap-south-1; do");

    // Every metric: the stream is not limited to the key ones.
    await act(async () => {
      fireEvent.click(part("every-metric"));
    });

    expect(command()).toContain("AWS::CloudWatch::MetricStream");
    expect(command()).not.toContain("IncludeFilters");

    // No Region at all: AWS CloudShell's own.
    await type("regions", "");

    expect(command()).toContain('"${AWS_REGION:-us-east-1}"');

    // Folded again, its line says every metric is on, and no Region is set.
    await openMoreFields();

    const items: Array<string> = within(fold)
      .getAllByTestId("folded-section-item")
      .map((item: HTMLElement): string => {
        return item.textContent || "";
      });

    expect(items).toContain("Every metric: On");
    expect(items).not.toContain("Regions: 0");
  });

  test("the template downloads as the file the command writes", async () => {
    const created: Array<Blob> = [];
    const urlApi: {
      createObjectURL?: ((blob: Blob) => string) | undefined;
      revokeObjectURL?: ((url: string) => void) | undefined;
    } = window.URL as unknown as {
      createObjectURL?: ((blob: Blob) => string) | undefined;
      revokeObjectURL?: ((url: string) => void) | undefined;
    };
    const originalCreate: ((blob: Blob) => string) | undefined =
      urlApi.createObjectURL;
    const originalRevoke: ((url: string) => void) | undefined =
      urlApi.revokeObjectURL;
    urlApi.createObjectURL = (blob: Blob): string => {
      created.push(blob);
      return "blob:template";
    };
    urlApi.revokeObjectURL = (): void => {
      // nothing to free in a test
    };
    let downloadName: string = "";
    const clickSpy: jest.SpyInstance<any, any> = getJestSpyOn(
      HTMLAnchorElement.prototype,
      "click",
    ).mockImplementation(function (this: HTMLAnchorElement): void {
      downloadName = this.download;
    });

    try {
      openDialog();

      await act(async () => {
        fireEvent.click(part("download"));
      });

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(downloadName).toBe("oneuptime-stream.json");
      expect(created).toHaveLength(1);

      const text: string = await new Promise<string>(
        (resolve: (value: string) => void) => {
          const reader: FileReader = new FileReader();
          reader.onload = (): void => {
            resolve(String(reader.result));
          };
          reader.readAsText(created[0]!);
        },
      );
      const template: JSONObject = JSON.parse(text) as JSONObject;

      expect(Object.keys(template)).toEqual(
        expect.arrayContaining(["Resources", "Parameters"]),
      );
      expect(text).toContain(METRICS_URL);
    } finally {
      urlApi.createObjectURL = originalCreate;
      urlApi.revokeObjectURL = originalRevoke;
    }
  });

  test("the last step asks every few seconds what arrived, and says it, with where it came from", async () => {
    jest.useFakeTimers();
    const lastDeliveryAt: string = minutesAgo(1);
    getItemSpy.mockResolvedValue(
      connection({
        streamKeyCreatedAt: new Date(minutesAgo(30)),
        streamSummary: {
          lastDeliveryAt,
          metricSources: [
            {
              accountId: "123456789012",
              region: "us-east-1",
              namespaces: ["AWS/EC2", "AWS/RDS", "AWS/Lambda"],
              lastAt: lastDeliveryAt,
            },
          ],
          logSources: [],
        },
      }),
    );
    openDialog(connection({ streamKeyCreatedAt: new Date(minutesAgo(30)) }));

    expect(part("live")).toHaveAttribute("data-state", "waiting");
    expect(part("live")).toHaveTextContent(
      "Waiting for the first delivery. Firehose delivers within a few minutes of the command finishing.",
    );
    expect(getItemSpy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(CLOUD_STREAM_POLL_MS);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // What is asked: when the key was made and what arrived, nothing else.
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(getItemSpy.mock.calls[0]![0]).toMatchObject({
      modelType: CloudConnection,
      select: { streamKeyCreatedAt: true, streamSummary: true },
    });
    expect(
      Object.keys(getItemSpy.mock.calls[0]![0].select as JSONObject).sort(),
    ).toEqual(["streamKeyCreatedAt", "streamSummary"]);
    expect(getItemSpy.mock.calls[0]![0].id.toString()).toBe(CONNECTION_ID);

    expect(part("live")).toHaveAttribute("data-state", "receiving");
    expect(part("live")).toHaveTextContent(
      `Receiving. The last delivery came ${OneUptimeDate.getDateAsLocalShortDateTimeString(new Date(lastDeliveryAt))}.`,
    );
    expect(part("sources")).toHaveTextContent(
      "Metrics of 3 namespaces from us-east-1",
    );
    // It has done its job.
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  test("a refused delivery says why, and what to do", () => {
    openDialog(
      connection({
        streamKeyCreatedAt: new Date(minutesAgo(30)),
        streamSummary: {
          lastRefusal: {
            reason: CloudStreamRefusalReason.TooLarge,
            at: minutesAgo(2),
          },
        },
      }),
    );

    expect(part("live")).toHaveAttribute("data-state", "refused");
    expect(part("live")).toHaveTextContent(
      CLOUD_STREAM_REFUSAL_WORDS[CloudStreamRefusalReason.TooLarge].reason,
    );
    expect(part("live")).toHaveTextContent(
      CLOUD_STREAM_REFUSAL_WORDS[CloudStreamRefusalReason.TooLarge].advice,
    );
    // Not done yet: the footer still says Close.
    expect(
      screen.queryByRole("button", { name: "Done" }),
    ).not.toBeInTheDocument();
  });

  test("a stream gone quiet says since when", () => {
    const lastDeliveryAt: string = minutesAgo(45);
    openDialog(
      connection({
        streamKeyCreatedAt: new Date(minutesAgo(600)),
        streamSummary: { lastDeliveryAt },
      }),
    );

    expect(part("live")).toHaveAttribute("data-state", "quiet");
    expect(part("live")).toHaveTextContent(
      `No delivery since ${OneUptimeDate.getDateAsLocalShortDateTimeString(new Date(lastDeliveryAt))}`,
    );
  });

  test("closed, it stops asking", async () => {
    jest.useFakeTimers();
    openDialog(connection({ streamKeyCreatedAt: new Date(minutesAgo(5)) }));

    cleanup();

    await act(async () => {
      jest.advanceTimersByTime(CLOUD_STREAM_POLL_MS * 4);
    });

    expect(getItemSpy).not.toHaveBeenCalled();
  });

  test("a connection that is turned off says its deliveries are refused", () => {
    openDialog(connection({ isEnabled: false }));

    expect(part("turned-off")).toHaveTextContent(
      "This connection is turned off, so its streams' deliveries are refused. Turn it on to take them.",
    );
  });

  test("a OneUptime not served over HTTPS cannot stream, and says so", () => {
    setProtocol(Protocol.HTTP);
    openDialog();

    expect(part("problem")).toHaveTextContent(
      "Firehose delivers to https:// addresses only, and this OneUptime is not served over HTTPS.",
    );
    expect(queryPart("command")).not.toBeInTheDocument();
    expect(queryPart("download")).not.toBeInTheDocument();
    // The key can still be made: the problem is the address, not the key.
    expect(part("make-key")).toBeInTheDocument();
  });

  test("the step-by-step guide is the streaming docs page", async () => {
    openDialog();
    await openMoreFields();

    expect(part("guide").getAttribute("href")).toMatch(
      /\/telemetry\/cloud-streaming$/,
    );
  });
});
