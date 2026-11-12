import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  CallOutcome,
  TwilioCallStatus,
  getCallOutcome,
  getTimeToCallOutcomeInMs,
} from "../../../FeatureSet/Notification/Utils/CallOutcome";
import { getProviderConfigOfCallback } from "../../../FeatureSet/Notification/Utils/StatusCallbackProviderConfig";
import { DocsFence, readPage, scanMarkdown } from "./DocsContentSupport";
import { COMMON_DIR, readCommonSource } from "./DocsDashboardMenus";
import { isDashboardLabel } from "./DocsDashboardLabels";
import {
  boldLabels,
  boldPaths,
  detailsBlocks,
  tabPanel,
  tables,
} from "./DocsPageShape";
import Telemetry, {
  TelemetryCounter,
  TelemetryHistogram,
} from "Common/Server/Utils/Telemetry";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import NotificationDeliveryMetrics, {
  MAX_CUSTOM_CHANNEL_NAME_LENGTH,
  NotificationDeliveryChannel,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
  NotificationDeliveryStatus,
  NotificationDestination,
  NotificationDispatch,
  NotificationProviderConfig,
  NotificationSchedule,
  NotificationTriggerSource,
  NotificationTriggerType,
  OnCallPageStart,
} from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import { DICTIONARY_FILTER_OPERATOR_OPTIONS } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import OnCallPageTiming from "Common/Server/Utils/OnCall/OnCallPageTiming";
import { getOnCallAcknowledgementTimeoutDueAt } from "Common/Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import { getOnCallPolicyRunPagingDueAt } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MonitorType from "Common/Types/Monitor/MonitorType";
import SmsStatus from "Common/Types/SmsStatus";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import dns from "dns";
import fs from "fs";
import { createRequire } from "module";
import path from "path";

/*
 * SELF HOSTED > NOTIFICATION DELIVERY METRICS (issue #6644), HELD TO THE CODE.
 *
 * The page tells an installation's operator what OneUptime records about
 * the notifications it sends (issues #6600, #6645, #6646, #6648), how to
 * turn it on, and the objectives to set on it. Every name, value, number
 * and setting it gives is read here from where the product takes it:
 *
 *   - the instruments AppMetrics creates (names, kinds, units, bucket
 *     edges), caught as Telemetry creates them;
 *   - the attributes each record function puts on them, recorded through
 *     those instruments, and the values of every enum the tables list;
 *   - which providers report a final status, read from the code that
 *     records one, and what each status means;
 *   - the exporter's settings in Telemetry, the Helm chart and Docker
 *     Compose, and that the exporter reads the temporality the page sets;
 *   - the workers' schedule, the metrics explorer's percentile and formula
 *     rules, and that every objective's query names real attributes and
 *     values and reads at a bucket's edge.
 *
 * A metric, attribute or value added, renamed or dropped in the code fails
 * here until the page says it.
 */

const PAGE_NAME: string = "self-hosted/notification-delivery-metrics";
const PAGE_URL: string = `/docs/${PAGE_NAME}`;
const NAV_TITLE: string = "Notification Delivery Metrics";
const NAV_GROUP: string = "Self Hosted";
const PREVIOUS_IN_NAV: string =
  "/docs/self-hosted/custom-notification-channels";

const PACKAGES_DIR: string = path.resolve(COMMON_DIR, "..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const APP_DIR: string = path.join(PACKAGES_DIR, "App");

const PAGE: string = readPage("en", PAGE_NAME);

const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const METRIC_NAME_IN_SOURCE: RegExp = /name:\s*"(notification\.[a-z_.]+)"/g;
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
// "`notification.channel = sms`": an attribute, an operator and a value.
const CONDITION: RegExp = /^(\S+) (=|!=) (\S+)$/;
// A run of white space in source, read as one space.
const WHITESPACE_RUN: RegExp = /\s+/g;

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readAppSource(relative: string): string {
  return fs.readFileSync(path.join(APP_DIR, relative), "utf8");
}

// The inline code of a piece of Markdown, in order.
function codeIn(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * A section of the page: its heading line, and every line up to the next
 * heading of its level or higher, fences left whole.
 */
function section(heading: string): string {
  const lines: Array<string> = PAGE.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start > -1 }).toEqual({ heading, found: true });

  const level: number = (heading.match(HEADING_LINE)?.[1] as string).length;
  let inFence: boolean = false;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    const found: RegExpMatchArray | null = inFence
      ? null
      : line.match(HEADING_LINE);

    if (found && (found[1] as string).length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// The text under a heading, up to the next heading of any level.
function ownText(heading: string): string {
  const text: string = section(heading);
  const next: number = text.search(/\n#{1,6}\s/);

  return next === -1 ? text : text.slice(0, next);
}

// The one table under a heading, before any subsection, without its header row.
function onlyTable(heading: string): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(ownText(heading));

  expect({ heading, tables: found.length }).toEqual({ heading, tables: 1 });

  return (found[0] as Array<Array<string>>).slice(1);
}

// The attributes an attribute table names: each row's first cell, split.
function attributesOf(rows: Array<Array<string>>): Array<string> {
  return rows
    .flatMap((row: Array<string>): Array<string> => {
      return codeIn(row[0] as string);
    })
    .sort();
}

// The row of an attribute table whose first cell names this attribute.
function rowOf(rows: Array<Array<string>>, attribute: string): Array<string> {
  const row: Array<string> | undefined = rows.find(
    (candidate: Array<string>): boolean => {
      return codeIn(candidate[0] as string).includes(attribute);
    },
  );

  expect({ attribute, found: Boolean(row) }).toEqual({
    attribute,
    found: true,
  });

  return row as Array<string>;
}

// An enum's values, in the order it declares them.
function valuesOf(enumObject: Record<string, string>): Array<string> {
  return Object.values(enumObject);
}

// The source between an opening bracket and its match: a call's arguments.
function balancedFrom(source: string, open: number): string {
  let depth: number = 0;

  for (let index: number = open; index < source.length; index++) {
    const character: string = source[index] as string;

    if (character === "(" || character === "{") {
      depth++;
    } else if (character === ")" || character === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }
  }

  throw new Error("An unbalanced call in the source.");
}

// Every member of an enum a piece of source names, as the enum's values.
function membersNamed(
  source: string,
  enumName: string,
  enumObject: Record<string, string>,
): Array<string> {
  const pattern: RegExp = new RegExp(`\\b${enumName}\\.([A-Za-z]+)\\b`, "g");

  return Array.from(
    new Set(
      Array.from(source.matchAll(pattern)).map(
        (match: RegExpMatchArray): string => {
          const value: string | undefined = enumObject[match[1] as string];

          expect({ member: match[1], known: value !== undefined }).toEqual({
            member: match[1],
            known: true,
          });

          return value as string;
        },
      ),
    ),
  ).sort();
}

// Every source file under a folder, tests and builds left out.
function sourceFiles(folder: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (
      ["node_modules", "build", "dist", "Tests", "Docs"].includes(entry.name)
    ) {
      continue;
    }

    const full: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }

  return found;
}

// A line that opens a top-level block; a comment at the margin does not.
const TOP_LEVEL_LINE: RegExp = /^[A-Za-z]/;

/*
 * A top-level block of a YAML file, as text: its key's line and every line
 * up to the next top-level key. Comments at the left margin stay inside.
 */
function yamlBlock(text: string, key: string): string {
  const lines: Array<string> = text.split("\n");
  // "key:", or "key: &anchor" for a block other blocks merge.
  const start: number = lines.findIndex((line: string): boolean => {
    return line === `${key}:` || line.startsWith(`${key}: &`);
  });

  expect({ key, found: start > -1 }).toEqual({ key, found: true });

  const end: number = lines.findIndex((line: string, index: number) => {
    return index > start && TOP_LEVEL_LINE.test(line);
  });

  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

// A line that opens a block nested two spaces in.
const NESTED_LINE: RegExp = /^ {2}[A-Za-z]/;

// A block nested two spaces in, inside a top-level block.
function nestedYamlBlock(block: string, key: string): string {
  const lines: Array<string> = block.split("\n");
  const start: number = lines.indexOf(`  ${key}:`);

  expect({ key, found: start > -1 }).toEqual({ key, found: true });

  const end: number = lines.findIndex((line: string, index: number) => {
    return index > start && NESTED_LINE.test(line);
  });

  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

/*
 * THE INSTRUMENTS, CAUGHT AS TELEMETRY CREATES THEM.
 *
 * AppMetrics creates each instrument through Telemetry.getCounter or
 * Telemetry.getHistogram on first use; these stand-ins keep what it asked
 * for and every set of attributes recorded on it since the last reset.
 */
interface CaughtInstrument {
  name: string;
  kind: "Counter" | "Histogram";
  unit: string | undefined;
  buckets: Array<number> | undefined;
  recorded: Array<Record<string, string>>;
}

interface InstrumentRequest {
  name: string;
  description: string;
  unit?: string | undefined;
  explicitBucketBoundaries?: Array<number> | undefined;
}

const caught: Map<string, CaughtInstrument> = new Map();

function standIn(
  kind: "Counter" | "Histogram",
  request: InstrumentRequest,
): CaughtInstrument & {
  add: (value: number, attributes?: Record<string, string>) => void;
  record: (value: number, attributes?: Record<string, string>) => void;
} {
  const instrument: CaughtInstrument = {
    name: request.name,
    kind: kind,
    unit: request.unit,
    buckets: request.explicitBucketBoundaries
      ? [...request.explicitBucketBoundaries]
      : undefined,
    recorded: [],
  };
  const take: (value: number, attributes?: Record<string, string>) => void = (
    _value: number,
    attributes?: Record<string, string>,
  ): void => {
    instrument.recorded.push({ ...(attributes || {}) });
  };

  caught.set(request.name, instrument);

  return { ...instrument, add: take, record: take };
}

// What was recorded on a metric since the last reset.
function recordedOn(name: string): Array<Record<string, string>> {
  return caught.get(name)?.recorded || [];
}

// The attribute names recorded on a metric, once each, sorted.
function attributeNamesOn(name: string): Array<string> {
  return Array.from(
    new Set(
      recordedOn(name).flatMap((attributes: Record<string, string>) => {
        return Object.keys(attributes);
      }),
    ),
  ).sort();
}

const NOTIFICATION_INSTRUMENTS: Array<() => unknown> = [
  (): unknown => {
    return AppMetrics.getNotificationTriggerCounter();
  },
  (): unknown => {
    return AppMetrics.getNotificationCounter();
  },
  (): unknown => {
    return AppMetrics.getNotificationDuration();
  },
  (): unknown => {
    return AppMetrics.getNotificationTimeToSend();
  },
  (): unknown => {
    return AppMetrics.getNotificationSendLag();
  },
  (): unknown => {
    return AppMetrics.getNotificationDeliveryCounter();
  },
  (): unknown => {
    return AppMetrics.getNotificationDeliveryDuration();
  },
];

const CUSTOM_CHANNEL: { id: string; name: string } = {
  id: "5c1b2d3e-0000-4000-8000-000000000001",
  name: "Pager bridge",
};

beforeAll(() => {
  jest.spyOn(Telemetry, "getCounter").mockImplementation(((
    request: InstrumentRequest,
  ): TelemetryCounter => {
    return standIn("Counter", request) as unknown as TelemetryCounter;
  }) as typeof Telemetry.getCounter);
  jest.spyOn(Telemetry, "getHistogram").mockImplementation(((
    request: InstrumentRequest,
  ): TelemetryHistogram => {
    return standIn("Histogram", request) as unknown as TelemetryHistogram;
  }) as typeof Telemetry.getHistogram);

  for (const create of NOTIFICATION_INSTRUMENTS) {
    create();
  }
});

beforeEach(() => {
  for (const instrument of Array.from(caught.values())) {
    instrument.recorded.length = 0;
  }
});

afterAll(() => {
  jest.restoreAllMocks();
});

/*
 * The stand-ins share their `recorded` array with the object AppMetrics
 * keeps, so a reset empties what both see.
 */
function instrument(name: string): CaughtInstrument {
  const found: CaughtInstrument | undefined = caught.get(name);

  expect({ name, created: Boolean(found) }).toEqual({ name, created: true });

  return found as CaughtInstrument;
}

describe("the page's place", () => {
  it("is in the Self Hosted nav group right after Custom Notification Channels, titled with its nav link", () => {
    const group: NavGroup | undefined = DocsNav.find((candidate: NavGroup) => {
      return candidate.title === NAV_GROUP;
    });
    const urls: Array<string> = (group?.links || []).map(
      (link: NavLink): string => {
        return link.url;
      },
    );
    const link: NavLink | undefined = group?.links.find(
      (candidate: NavLink): boolean => {
        return candidate.url === PAGE_URL;
      },
    );

    expect(link?.title).toBe(NAV_TITLE);
    expect(urls.indexOf(PAGE_URL)).toBe(urls.indexOf(PREVIOUS_IN_NAV) + 1);
    expect(PAGE.split("\n")[0]).toBe(`# ${NAV_TITLE}`);
  });

  it("is linked from the pages of the providers and channels it reports on", () => {
    for (const page of [
      "self-hosted/twilio-integration",
      "self-hosted/sms-and-call-gateway",
      "self-hosted/push-notifications",
      "self-hosted/custom-notification-channels",
    ]) {
      const targets: Array<string> = scanMarkdown(
        readPage("en", page),
      ).links.map((link: { target: string }): string => {
        return link.target.split("#")[0] as string;
      });

      expect({ page, links: targets.includes(PAGE_URL) }).toEqual({
        page,
        links: true,
      });
    }
  });
});

describe("the metrics", () => {
  const rows: Array<Array<string>> = onlyTable("## The metrics");

  it("are every notification metric AppMetrics creates, and no other", () => {
    const inSource: Array<string> = Array.from(
      readCommonSource("Server/Utils/Telemetry/AppMetrics.ts").matchAll(
        METRIC_NAME_IN_SOURCE,
      ),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1] as string;
      })
      .sort();
    const onPage: Array<string> = rows
      .map((row: Array<string>): string => {
        return codeIn(row[0] as string)[0] as string;
      })
      .sort();

    expect(onPage).toEqual(inSource);
    expect(Array.from(caught.keys()).sort()).toEqual(inSource);
  });

  it("name each metric's kind and unit as AppMetrics creates it", () => {
    for (const row of rows) {
      const name: string = codeIn(row[0] as string)[0] as string;
      const created: CaughtInstrument = instrument(name);

      expect({ name, kind: row[1], unit: codeIn(row[2] as string) }).toEqual({
        name,
        kind: created.kind,
        unit: [created.unit],
      });
    }
  });

  it("are drawn in the diagram by their own names", () => {
    const diagram: DocsFence | undefined = scanMarkdown(PAGE).fences.find(
      (fence: DocsFence): boolean => {
        return fence.lang === "mermaid";
      },
    );
    const named: Array<string> = Array.from(
      (diagram?.code || "").matchAll(/notification\.[a-z_.]*[a-z]/g),
    ).map((match: RegExpMatchArray): string => {
      return match[0];
    });

    expect(named.length).toBeGreaterThanOrEqual(6);

    for (const name of named) {
      expect({ name, created: caught.has(name) }).toEqual({
        name,
        created: true,
      });
    }
  });

  it("cut a custom channel's name to the length the page gives", () => {
    const attributes: Record<string, string> =
      NotificationDeliveryMetrics.getDispatchAttributes({
        channel: NotificationDeliveryChannel.CustomChannel,
        provider: NotificationDeliveryProvider.CustomChannel,
        providerConfig: NotificationProviderConfig.Project,
        isOnCallPage: false,
        customChannel: { id: CUSTOM_CHANNEL.id, name: "n".repeat(250) },
        outcome: NotificationDeliveryOutcome.Success,
      });

    expect(MAX_CUSTOM_CHANNEL_NAME_LENGTH).toBe(100);
    expect(attributes["notification.custom_channel.name"]).toHaveLength(
      MAX_CUSTOM_CHANNEL_NAME_LENGTH,
    );
    expect(
      rowOf(
        onlyTable("### Messages handed to a provider"),
        "notification.custom_channel.name",
      )[1],
    ).toContain(`cut to ${MAX_CUSTOM_CHANNEL_NAME_LENGTH} characters`);
  });
});

describe("records that notify people", () => {
  const heading: string = "### Records that notify people";
  const rows: Array<Array<string>> = onlyTable(heading);

  it("carry the attributes recordTrigger records, and no other", () => {
    NotificationDeliveryMetrics.recordTrigger({
      type: NotificationTriggerType.Incident,
      source: NotificationTriggerSource.Automatic,
      monitorType: MonitorType.Metrics,
    });

    expect(attributesOf(rows)).toEqual(
      attributeNamesOn("notification.trigger.count"),
    );
  });

  it("leave the monitor's type out when no monitor created the record", () => {
    NotificationDeliveryMetrics.recordTrigger({
      type: NotificationTriggerType.AlertEpisode,
      source: NotificationTriggerSource.Manual,
    });

    expect(recordedOn("notification.trigger.count")).toEqual([
      {
        "notification.trigger.type": "alert_episode",
        "notification.trigger.source": "manual",
      },
    ]);
  });

  it("list every type and source, in the code's order, and monitor types that are MonitorType's", () => {
    expect(
      codeIn(rowOf(rows, "notification.trigger.type")[1] as string),
    ).toEqual(valuesOf(NotificationTriggerType));
    expect(
      codeIn(rowOf(rows, "notification.trigger.source")[1] as string),
    ).toEqual(valuesOf(NotificationTriggerSource));

    for (const example of codeIn(rowOf(rows, "monitor.type")[1] as string)) {
      expect(
        valuesOf(MonitorType as unknown as Record<string, string>),
      ).toContain(example);
    }
  });

  it("are counted as each of the four records is created, automatic or manual as the page says", () => {
    const services: Array<[string, NotificationTriggerType]> = [
      ["Server/Services/IncidentService.ts", NotificationTriggerType.Incident],
      ["Server/Services/AlertService.ts", NotificationTriggerType.Alert],
      [
        "Server/Services/IncidentEpisodeService.ts",
        NotificationTriggerType.IncidentEpisode,
      ],
      [
        "Server/Services/AlertEpisodeService.ts",
        NotificationTriggerType.AlertEpisode,
      ],
    ];

    for (const [file, type] of services) {
      const source: string = readCommonSource(file);
      const at: number = source.indexOf(
        "NotificationDeliveryMetrics.recordTrigger(",
      );

      expect({ file, records: at > -1 }).toEqual({ file, records: true });

      const call: string = balancedFrom(source, source.indexOf("(", at));

      expect({
        file,
        types: membersNamed(
          call,
          "NotificationTriggerType",
          NotificationTriggerType as unknown as Record<string, string>,
        ),
        sources: membersNamed(
          call,
          "NotificationTriggerSource",
          NotificationTriggerSource as unknown as Record<string, string>,
        ),
      }).toEqual({
        file,
        types: [type],
        sources: ["automatic", "manual"],
      });
    }
  });
});

describe("messages handed to a provider", () => {
  const heading: string = "### Messages handed to a provider";
  const rows: Array<Array<string>> = onlyTable(heading);

  it("carry the attributes a send records, on both its count and its duration", async () => {
    await NotificationDeliveryMetrics.measureDispatch(
      {
        channel: NotificationDeliveryChannel.Slack,
        provider: NotificationDeliveryProvider.Slack,
        providerConfig: NotificationProviderConfig.Project,
        isOnCallPage: true,
        destination: NotificationDestination.DirectMessage,
      },
      async (): Promise<void> => {},
    );
    await NotificationDeliveryMetrics.measureDispatch(
      {
        channel: NotificationDeliveryChannel.CustomChannel,
        provider: NotificationDeliveryProvider.CustomChannel,
        providerConfig: NotificationProviderConfig.Project,
        customChannel: CUSTOM_CHANNEL,
      },
      async (_dispatch: NotificationDispatch): Promise<void> => {},
    );

    const onCount: Array<string> = attributeNamesOn("notification.send.count");

    expect(attributesOf(rows)).toEqual(onCount);
    expect(attributeNamesOn("notification.send.duration")).toEqual(onCount);
  });

  it("list every channel, provider, account, destination and outcome, in the code's order", () => {
    const providers: Array<string> = valuesOf(NotificationDeliveryProvider);

    expect(codeIn(rowOf(rows, "notification.channel")[1] as string)).toEqual(
      valuesOf(NotificationDeliveryChannel),
    );
    // Every provider, then "none" for a message handed to none.
    expect(codeIn(rowOf(rows, "notification.provider")[1] as string)).toEqual([
      ...providers.filter((provider: string): boolean => {
        return provider !== NotificationDeliveryProvider.None;
      }),
      NotificationDeliveryProvider.None,
    ]);
    expect(
      codeIn(rowOf(rows, "notification.provider.config")[1] as string),
    ).toEqual(valuesOf(NotificationProviderConfig));
    expect(
      codeIn(rowOf(rows, "notification.destination")[1] as string),
    ).toEqual(valuesOf(NotificationDestination));
    expect(codeIn(rowOf(rows, "outcome")[1] as string)).toEqual(
      valuesOf(NotificationDeliveryOutcome),
    );
  });

  it("say an on-call page as the strings true and false", () => {
    const of: (isOnCallPage: boolean) => string | undefined = (
      isOnCallPage: boolean,
    ): string | undefined => {
      return NotificationDeliveryMetrics.getDispatchAttributes({
        channel: NotificationDeliveryChannel.SMS,
        provider: NotificationDeliveryProvider.Twilio,
        providerConfig: NotificationProviderConfig.Global,
        isOnCallPage: isOnCallPage,
        outcome: NotificationDeliveryOutcome.Success,
      })["notification.on_call_page"];
    };

    expect([of(true), of(false)]).toEqual(
      codeIn(rowOf(rows, "notification.on_call_page")[1] as string),
    );
  });

  it("explain each outcome in a list item of its own", () => {
    const items: Array<string> = section(heading)
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- ");
      })
      .map((line: string): string => {
        return codeIn(line)[0] as string;
      });

    expect(items).toEqual(valuesOf(NotificationDeliveryOutcome));
  });

  it("count a message not sent, or failed before a provider, with no duration", () => {
    NotificationDeliveryMetrics.recordNotSent({
      channel: NotificationDeliveryChannel.Push,
    });
    NotificationDeliveryMetrics.recordFailedBeforeSend({
      channel: NotificationDeliveryChannel.Slack,
      destination: NotificationDestination.Channel,
    });

    expect(
      recordedOn("notification.send.count").map(
        (attributes: Record<string, string>): string | undefined => {
          return attributes["outcome"];
        },
      ),
    ).toEqual(["not_sent", "failure"]);
    expect(recordedOn("notification.send.duration")).toEqual([]);
    // Nothing was handed to a provider.
    expect(
      recordedOn("notification.send.count")[0]?.["notification.provider"],
    ).toBe("none");
  });

  /*
   * A status page subscriber's own webhook (issue #6685), sent through its
   * real sender: the address check is real - a private address refused
   * with no request, a public name looked up through a stand-in DNS - and
   * only the post itself is stood in for.
   */
  describe("a status page subscriber's own webhook", () => {
    const PUBLIC_HOOK: string = "https://hooks.example.com/oneuptime";
    const PRIVATE_HOOK: string = "http://10.0.0.5/oneuptime";

    let lookup: SpyInstance<typeof dns.promises.lookup> | null = null;
    let post: SpyInstance<typeof API.post> | null = null;

    // Each send's answer from the endpoint, in turn: a response, or a throw.
    const answers: Array<HTTPResponse<JSONObject> | HTTPErrorResponse | Error> =
      [];

    beforeEach(() => {
      answers.length = 0;
      lookup = jest
        .spyOn(dns.promises, "lookup")
        .mockResolvedValue([
          { address: "93.184.216.34", family: 4 },
        ] as never) as unknown as SpyInstance<typeof dns.promises.lookup>;
      post = jest.spyOn(API, "post").mockImplementation((async (): Promise<
        HTTPResponse<JSONObject> | HTTPErrorResponse
      > => {
        const answer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error =
          answers.shift() || new HTTPResponse<JSONObject>(200, {}, {});

        if (answer instanceof Error) {
          throw answer;
        }

        return answer;
      }) as typeof API.post) as unknown as SpyInstance<typeof API.post>;
    });

    afterEach(() => {
      // Only this block's own stand-ins: the instruments' stay.
      lookup?.mockRestore();
      post?.mockRestore();
      lookup = null;
      post = null;
    });

    const send: (
      webhookUrl: string,
    ) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse | Error> = async (
      webhookUrl: string,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse | Error> => {
      try {
        return await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
          webhookUrl: URL.fromString(webhookUrl),
          isAddedByTeam: false,
          payload: {
            eventType: "Incident Created",
            statusPageId: "5c1b2d3e-0000-4000-8000-000000000002",
            statusPageName: "Acme Status",
            statusPageUrl: "https://status.acme.example.com",
            unsubscribeUrl: "https://status.acme.example.com/unsubscribe",
            data: {},
          },
        });
      } catch (err) {
        return err as Error;
      }
    };

    it("is counted as the page's rows say: a webhook on the project's side, to a status page subscriber, never a page", async () => {
      await send(PUBLIC_HOOK);

      const expected: Record<string, string> = {
        "notification.channel": NotificationDeliveryChannel.Webhook,
        "notification.provider": NotificationDeliveryProvider.Webhook,
        "notification.provider.config": NotificationProviderConfig.Project,
        "notification.on_call_page": "false",
        outcome: NotificationDeliveryOutcome.Success,
        "notification.destination":
          NotificationDestination.StatusPageSubscriber,
      };

      expect(recordedOn("notification.send.count")).toEqual([expected]);
      expect(recordedOn("notification.send.duration")).toEqual([expected]);

      // Every value it carries is one the rows list for it.
      expect(
        codeIn(rowOf(rows, "notification.channel")[1] as string),
      ).toContain(expected["notification.channel"]);
      expect(
        codeIn(rowOf(rows, "notification.provider")[1] as string),
      ).toContain(expected["notification.provider"]);
      expect(
        codeIn(rowOf(rows, "notification.provider.config")[1] as string),
      ).toContain(expected["notification.provider.config"]);

      const destination: string = rowOf(
        rows,
        "notification.destination",
      )[1] as string;

      expect(destination).toContain(
        "Webhooks: `status_page_subscriber` for a status page subscriber's own webhook. Left out on a person's webhook and on every other channel",
      );
    });

    it("leaves the destination out on a person's webhook, as the destination row says", () => {
      const personsWebhook: string = readAppSource(
        "FeatureSet/Notification/Services/WebhookService.ts",
      );

      // The person's sender records a webhook, and names no destination.
      expect(personsWebhook).toContain("NotificationDeliveryChannel.Webhook");
      expect(
        membersNamed(
          personsWebhook,
          "NotificationDestination",
          NotificationDestination as unknown as Record<string, string>,
        ),
      ).toEqual([]);
      expect(personsWebhook).not.toContain("destination:");
    });

    it("is counted once a message, however many times it was tried: success for a 2xx answer, failure for any other, for none, and for an address that is not allowed", async () => {
      answers.push(
        new HTTPResponse<JSONObject>(200, {}, {}),
        new HTTPResponse<JSONObject>(204, {}, {}),
        new HTTPResponse<JSONObject>(302, {}, {}),
        new HTTPErrorResponse(404, { message: "Not Found" }, {}),
        new HTTPErrorResponse(503, { message: "Unavailable" }, {}),
        new Error("connect ECONNREFUSED"),
      );

      for (let index: number = 0; index < 6; index++) {
        await send(PUBLIC_HOOK);
      }

      await send(PRIVATE_HOOK);

      expect(
        recordedOn("notification.send.count").map(
          (attributes: Record<string, string>): string | undefined => {
            return attributes["outcome"];
          },
        ),
      ).toEqual([
        "success",
        "success",
        "failure",
        "failure",
        "failure",
        "failure",
        "failure",
      ]);
      // Each was timed, the refused one too: it was handed to the sender.
      expect(recordedOn("notification.send.duration")).toHaveLength(7);

      // The private address was refused before any request was made.
      expect(post).toHaveBeenCalledTimes(6);

      // One post a message, which tries again on its own: counted once.
      for (const call of post!.mock.calls) {
        const options: { retries?: number } | undefined = (
          call[0] as { options?: { retries?: number } }
        ).options;

        expect(options?.retries).toBeGreaterThan(1);
      }

      expect(section(heading)).toContain(
        "A message to a status page subscriber's own webhook counts once, however many times it was tried: `success` when the endpoint answered with a 2xx status, and `failure` when it answered with another status, could not be reached, or its address is not allowed.",
      );
    });
  });
});

/*
 * Every call that records a final status, read from the source: the
 * channel, the providers, whose account it names and whether it is timed.
 */
interface DeliveryCall {
  file: string;
  channels: Array<string>;
  providers: Array<string>;
  providerConfig: string;
  timed: boolean;
}

function deliveryCalls(): Array<DeliveryCall> {
  const files: Array<string> = [
    ...sourceFiles(path.join(COMMON_DIR, "Server")),
    ...sourceFiles(path.join(APP_DIR, "FeatureSet")),
  ];
  const calls: Array<DeliveryCall> = [];

  for (const file of files) {
    const source: string = fs.readFileSync(file, "utf8");
    let at: number = source.indexOf(
      "NotificationDeliveryMetrics.recordDelivery(",
    );

    while (at > -1) {
      const call: string = balancedFrom(source, source.indexOf("(", at));

      calls.push({
        file: path.relative(PACKAGES_DIR, file),
        channels: membersNamed(
          call,
          "NotificationDeliveryChannel",
          NotificationDeliveryChannel as unknown as Record<string, string>,
        ),
        providers: membersNamed(
          call,
          "NotificationDeliveryProvider",
          NotificationDeliveryProvider as unknown as Record<string, string>,
        ),
        providerConfig: call.includes("getProviderConfigOfCallback(")
          ? "callback"
          : membersNamed(
              call,
              "NotificationProviderConfig",
              NotificationProviderConfig as unknown as Record<string, string>,
            ).join(","),
        timed: call.includes("timeToStatusInMs"),
      });

      at = source.indexOf(
        "NotificationDeliveryMetrics.recordDelivery(",
        at + 1,
      );
    }
  }

  return calls;
}

describe("what reached the phone", () => {
  const heading: string = "### What reached the phone";
  const rows: Array<Array<string>> = onlyTable(heading);
  const calls: Array<DeliveryCall> = deliveryCalls();

  // A table row by its channel.
  const rowFor: (channel: string) => Array<string> = (
    channel: string,
  ): Array<string> => {
    const row: Array<string> | undefined = rows.find(
      (candidate: Array<string>): boolean => {
        return codeIn(candidate[0] as string)[0] === channel;
      },
    );

    expect({ channel, row: Boolean(row) }).toEqual({ channel, row: true });

    return row as Array<string>;
  };

  it("finds the four places a final status is recorded", () => {
    expect(
      calls
        .map((call: DeliveryCall): string => {
          return call.file;
        })
        .sort(),
    ).toEqual(
      [
        "App/FeatureSet/Notification/API/Call.ts",
        "App/FeatureSet/Notification/API/SMS.ts",
        "App/FeatureSet/Notification/API/WhatsApp.ts",
        "Common/Server/Services/ExpoPushReceiptService.ts",
      ].sort(),
    );
  });

  it("lists every channel and provider that reports a final status, and no other", () => {
    const fromCode: Array<string> = calls
      .map((call: DeliveryCall): string => {
        return `${call.channels.join(",")}: ${call.providers.join(",")}`;
      })
      .sort();
    const onPage: Array<string> = rows
      .map((row: Array<string>): string => {
        return `${codeIn(row[0] as string).join(",")}: ${codeIn(
          row[1] as string,
        )
          .sort()
          .join(",")}`;
      })
      .sort();

    expect(onPage).toEqual(fromCode);
  });

  it("names the channels with no final status: every other channel", () => {
    const reported: Array<string> = calls.flatMap(
      (call: DeliveryCall): Array<string> => {
        return call.channels;
      },
    );
    const silent: Array<string> = valuesOf(NotificationDeliveryChannel).filter(
      (channel: string): boolean => {
        return !reported.includes(channel);
      },
    );

    expect(silent.sort()).toEqual(
      [
        "custom_channel",
        "email",
        "mattermost",
        "microsoft_teams",
        "slack",
        "telegram",
        "webhook",
      ].sort(),
    );
    expect(section(heading)).toContain(
      "- Email, Telegram, webhooks, chat and custom channels report no final status.",
    );
    // The gateway has no status callback: it is never a provider of one.
    expect(
      calls.flatMap((call: DeliveryCall): Array<string> => {
        return call.providers;
      }),
    ).not.toContain(NotificationDeliveryProvider.SmsAndCallGateway);
  });

  it("times every channel but push, as the Duration column says", () => {
    for (const call of calls) {
      const channel: string = call.channels[0] as string;

      expect({
        channel,
        notTimed: (rowFor(channel)[3] as string).startsWith("Not timed"),
      }).toEqual({ channel, notTimed: !call.timed });
    }
  });

  it("says each channel's statuses as the code reads them from its provider", () => {
    const sms: Array<string> = valuesOf(
      SmsStatus as unknown as Record<string, string>,
    )
      .map((status: string): string | null => {
        return NotificationDeliveryMetrics.getDeliveryStatusOfSms(
          status as SmsStatus,
        );
      })
      .filter((status: string | null): status is string => {
        return status !== null;
      });
    const whatsApp: Array<string> = valuesOf(
      WhatsAppStatus as unknown as Record<string, string>,
    )
      .map((status: string): string | null => {
        return NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp(
          status as WhatsAppStatus,
        );
      })
      .filter((status: string | null): status is string => {
        return status !== null;
      });
    const call: Array<string> = valuesOf(TwilioCallStatus)
      .map((status: string): string | null => {
        return (
          getCallOutcome({ providerStatus: status })?.deliveryStatus || null
        );
      })
      .filter((status: string | null): status is string => {
        return status !== null;
      });
    const push: Array<string> = membersNamed(
      readCommonSource("Server/Services/ExpoPushReceiptService.ts"),
      "NotificationDeliveryStatus",
      NotificationDeliveryStatus as unknown as Record<string, string>,
    );
    const once: (statuses: Array<string>) => Array<string> = (
      statuses: Array<string>,
    ): Array<string> => {
      return Array.from(new Set(statuses)).sort();
    };

    expect(once(codeIn(rowFor("sms")[2] as string))).toEqual(once(sms));
    expect(once(codeIn(rowFor("whatsapp")[2] as string))).toEqual(
      once(whatsApp),
    );
    expect(once(codeIn(rowFor("call")[2] as string))).toEqual(once(call));
    expect(once(codeIn(rowFor("push")[2] as string))).toEqual(once(push));
  });

  it("says what a call that rang out, was busy or declined, a gone app and a read message are", () => {
    for (const status of [TwilioCallStatus.NoAnswer, TwilioCallStatus.Busy]) {
      expect(getCallOutcome({ providerStatus: status })?.deliveryStatus).toBe(
        NotificationDeliveryStatus.NotAnswered,
      );
    }

    expect(
      NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp(
        WhatsAppStatus.Read,
      ),
    ).toBe(NotificationDeliveryStatus.Delivered);
    expect(
      readCommonSource("Server/Services/ExpoPushReceiptService.ts").replace(
        /\s+/g,
        " ",
      ),
    ).toContain(
      "code === EXPO_DEVICE_NOT_REGISTERED ? NotificationDeliveryStatus.Undelivered : NotificationDeliveryStatus.Failed",
    );
  });

  it("times a call until it was picked up, or else until it ended", () => {
    const answered: CallOutcome = getCallOutcome({
      providerStatus: TwilioCallStatus.Completed,
      durationInSeconds: 42,
    }) as CallOutcome;
    const rangOut: CallOutcome = getCallOutcome({
      providerStatus: TwilioCallStatus.NoAnswer,
    }) as CallOutcome;

    expect(
      getTimeToCallOutcomeInMs({
        outcome: answered,
        millisecondsSincePlaced: 60000,
      }),
    ).toBe(18000);
    expect(
      getTimeToCallOutcomeInMs({
        outcome: rangOut,
        millisecondsSincePlaced: 60000,
      }),
    ).toBe(60000);
    expect(rowFor("call")[3]).toBe(
      "Until the call was picked up, or else ended",
    );
  });

  it("names a project's account only for SMS and calls, from their status callback", () => {
    for (const call of calls) {
      const channel: string = call.channels[0] as string;

      expect({ channel, config: call.providerConfig }).toEqual({
        channel,
        config: ["sms", "call"].includes(channel) ? "callback" : "global",
      });
    }

    expect(getProviderConfigOfCallback({ providerConfig: "project" })).toBe(
      NotificationProviderConfig.Project,
    );
    expect(getProviderConfigOfCallback({})).toBe(
      NotificationProviderConfig.Global,
    );
  });

  it("carries the attributes a final status records, on its count and its duration", () => {
    NotificationDeliveryMetrics.recordDelivery({
      channel: NotificationDeliveryChannel.SMS,
      provider: NotificationDeliveryProvider.Twilio,
      providerConfig: NotificationProviderConfig.Project,
      isOnCallPage: true,
      status: NotificationDeliveryStatus.Undelivered,
      timeToStatusInMs: 4000,
    });

    const said: Array<string> = codeIn(
      section(heading)
        .split("\n")
        .find((line: string): boolean => {
          return line.includes("Both carry");
        }) as string,
    )
      .filter((code: string): boolean => {
        return !code.endsWith(".count") && !code.endsWith(".duration");
      })
      .sort();

    expect(said).toEqual(attributeNamesOn("notification.delivery.count"));
    expect(attributeNamesOn("notification.delivery.duration")).toEqual(said);
    expect(recordedOn("notification.delivery.count")[0]?.["outcome"]).toBe(
      "undelivered",
    );
  });

  it("says when Expo's receipts are read, and that the push relay's are too", () => {
    const queue: string = readCommonSource(
      "Server/Infrastructure/ExpoPushReceiptQueue.ts",
    );
    const firstCheck: RegExpMatchArray | null = queue.match(
      /EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS: number = (\d+) \* 60 \* 1000;/,
    );

    expect(firstCheck?.[1]).toBe("15");
    expect(section(heading)).toContain(
      "which OneUptime reads about 15 minutes after the push, through the push relay too",
    );
  });
});

describe("how a page is timed", () => {
  it("time to send carries the attributes recordTimeToSend records, and every start", () => {
    const rows: Array<Array<string>> = tables(
      section("### Time to send"),
    )[0]?.slice(1) as Array<Array<string>>;
    const starts: Array<Array<string>> = tables(
      section("### Time to send"),
    )[1]?.slice(1) as Array<Array<string>>;

    NotificationDeliveryMetrics.recordTimeToSend({
      channel: NotificationDeliveryChannel.CustomChannel,
      customChannel: CUSTOM_CHANNEL,
      triggerType: NotificationTriggerType.Incident,
      pageStart: OnCallPageStart.MonitorDataReceived,
      timeToSendInMs: 1200,
    });

    expect(attributesOf(rows)).toEqual(
      attributeNamesOn("notification.time_to_send"),
    );
    expect(
      codeIn(rowOf(rows, "notification.trigger.type")[1] as string),
    ).toEqual(valuesOf(NotificationTriggerType));
    expect(
      starts.map((row: Array<string>): string => {
        return codeIn(row[0] as string)[0] as string;
      }),
    ).toEqual(valuesOf(OnCallPageStart));
  });

  /*
   * Issue #6708: a page a once-a-minute worker starts when it comes due is
   * timed from when it was due - a held run from when its hold ran out, a
   * page again from when its acknowledgement timeout ran out - read with
   * the helpers the workers decide with, and handed to the page's start.
   */
  it("times a held page and a page again from when they were due, as the page_started row says", () => {
    const starts: Array<Array<string>> = tables(
      section("### Time to send"),
    )[1]?.slice(1) as Array<Array<string>>;
    const pageStarted: string = starts.find((row: Array<string>): boolean => {
      return codeIn(row[0] as string)[0] === OnCallPageStart.PageStarted;
    })?.[1] as string;

    expect(pageStarted).toContain(
      "For a page held by its on-call rule or by OneUptime AI, when its hold ran out, or when it started if that was sooner.",
    );
    expect(pageStarted).toContain(
      "For a page again, when its acknowledgement timeout ran out.",
    );
    expect(pageStarted).toContain(
      "So a worker that got to either late shows in the time.",
    );

    const now: Date = new Date("2026-11-11T09:07:30.000Z");
    const holdRanOut: Date = new Date("2026-11-11T09:00:00.000Z");

    // A hold that ran out seven minutes before the worker got to it.
    expect(
      getOnCallPolicyRunPagingDueAt({ pagingStartsAt: holdRanOut, now: now }),
    ).toEqual(holdRanOut);
    // A held page started before its hold ran out: when it started.
    expect(
      getOnCallPolicyRunPagingDueAt({
        pagingStartsAt: new Date("2026-11-11T10:00:00.000Z"),
        now: now,
      }),
    ).toEqual(now);
    // A page again: the timeout's start and its minutes.
    expect(
      getOnCallAcknowledgementTimeoutDueAt({
        startedAt: new Date("2026-11-11T08:30:00.000Z"),
        minutes: 30,
      }),
    ).toEqual(holdRanOut);

    // Outside a record's creation, a page started with when it was due.
    expect(OnCallPageTiming.startPage({ dueAt: holdRanOut })).toEqual({
      startedAt: holdRanOut,
      start: OnCallPageStart.PageStarted,
    });

    // Handed over where the workers start them.
    expect(
      readCommonSource(
        "Server/Services/OnCallDutyPolicyExecutionLogService.ts",
      ).replace(WHITESPACE_RUN, " "),
    ).toContain(
      "dueAt: getOnCallPolicyRunPagingDueAt({ pagingStartsAt: run.pagingStartsAt, now: data.now, }),",
    );
    expect(
      readCommonSource(
        "Server/Utils/OnCall/OnCallAcknowledgementTimeout.ts",
      ).replace(WHITESPACE_RUN, " "),
    ).toContain(
      "dueAt: getOnCallAcknowledgementTimeoutDueAt({ startedAt: startedAt, minutes: minutes, }),",
    );

    // Neither is in send lag: their notifications are due as the page starts.
    expect(
      section("### Send lag")
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("It also carries");
        }),
    ).toContain(
      "A notification due as its page starts is never in it, even when a worker started the page late, after a hold or as a page again: it is in time to send.",
    );
  });

  it("send lag carries the attributes recordSendLag records, and every schedule", () => {
    const lag: string = section("### Send lag");
    const schedules: Array<Array<string>> = tables(lag)[0]?.slice(1) as Array<
      Array<string>
    >;
    const alsoCarries: string = lag
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("It also carries");
      }) as string;

    NotificationDeliveryMetrics.recordSendLag({
      channel: NotificationDeliveryChannel.CustomChannel,
      customChannel: CUSTOM_CHANNEL,
      triggerType: NotificationTriggerType.Alert,
      schedule: NotificationSchedule.RuleWait,
      lagInMs: 61000,
    });

    expect(["notification.schedule", ...codeIn(alsoCarries)].sort()).toEqual(
      attributeNamesOn("notification.send.lag"),
    );
    expect(
      schedules.map((row: Array<string>): string => {
        return codeIn(row[0] as string)[0] as string;
      }),
    ).toEqual(valuesOf(NotificationSchedule));
  });

  it("send lag comes from two workers that run once a minute, two schedules each", () => {
    const workers: Array<{
      job: string;
      helper: string;
      helperFile: string;
      schedules: Array<string>;
    }> = [
      {
        job: "FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions.ts",
        helper: "Common/Server/Utils/OnCall/OnCallSendLag",
        helperFile: "Server/Utils/OnCall/OnCallSendLag.ts",
        schedules: ["repeat", "rule_wait"],
      },
      {
        job: "FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions.ts",
        helper: "Common/Server/Utils/OnCall/OnCallEscalationAdvance",
        helperFile: "Server/Utils/OnCall/OnCallEscalationAdvance.ts",
        schedules: ["escalation", "policy_repeat"],
      },
    ];

    for (const worker of workers) {
      const job: string = readAppSource(worker.job);
      const schedule: string | undefined = job.match(
        /RunCron\(\s*"[^"]+",\s*\{\s*schedule:\s*([^,]+),/,
      )?.[1];

      expect({ job: worker.job, schedule: schedule?.trim() }).toEqual({
        job: worker.job,
        schedule: expect.stringMatching(/EVERY_MINUTE$/),
      });
      expect(
        (schedule || "").replace(/IsDevelopment|EVERY_MINUTE|[?:\s]/g, ""),
      ).toBe("");
      expect(job).toContain(`from "${worker.helper}"`);
      expect(
        membersNamed(
          readCommonSource(worker.helperFile),
          "NotificationSchedule",
          NotificationSchedule as unknown as Record<string, string>,
        ),
      ).toEqual(worker.schedules);
    }

    expect(PAGE).toContain(
      "`rule_wait` and `repeat` are one worker's, `escalation` and `policy_repeat` the other's.",
    );
  });

  it("lists each histogram's bucket edges as AppMetrics sets them", () => {
    const rows: Array<Array<string>> = onlyTable("### Histogram buckets");
    const histograms: Array<CaughtInstrument> = Array.from(
      caught.values(),
    ).filter((created: CaughtInstrument): boolean => {
      return created.kind === "Histogram";
    });

    expect(
      rows
        .map((row: Array<string>): string => {
          return codeIn(row[0] as string)[0] as string;
        })
        .sort(),
    ).toEqual(
      histograms
        .map((created: CaughtInstrument): string => {
          return created.name;
        })
        .sort(),
    );

    for (const row of rows) {
      const name: string = codeIn(row[0] as string)[0] as string;
      const edges: Array<number> = (codeIn(row[1] as string)[0] as string)
        .split(", ")
        .map(Number);

      expect({ name, edges }).toEqual({
        name,
        edges: instrument(name).buckets,
      });
    }

    expect(instrument("notification.send.lag").buckets).toEqual([
      ...AppMetrics.NOTIFICATION_SEND_LAG_BUCKETS_IN_MS,
    ]);
  });

  it("says a percentile is drawn as the middle of its bucket, as the metrics explorer works it out", () => {
    expect(readCommonSource("Server/Services/MetricService.ts")).toContain(
      "(toFloat64(explicitBounds[i - 1]) + toFloat64(explicitBounds[i])) / 2.0",
    );
  });
});

describe("turning them on", () => {
  const telemetry: string = readCommonSource("Server/Utils/Telemetry.ts");
  const savedEnv: NodeJS.ProcessEnv = { ...process.env };

  afterAll(() => {
    process.env = savedEnv;
  });

  it("sends metrics only with an endpoint and a header, to /v1/metrics, with traces and logs alike", () => {
    process.env["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"] =
      "https://oneuptime.example.com/otlp";
    process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"] =
      "x-oneuptime-token=key;x-extra=1";

    expect(Telemetry.getOltpMetricsEndpoint()?.toString()).toBe(
      "https://oneuptime.example.com/otlp/v1/metrics",
    );
    expect(Telemetry.getHeaders()).toEqual({
      "x-oneuptime-token": "key",
      "x-extra": "1",
    });

    for (const signal of ["Traces", "Metrics", "Logs"]) {
      expect(telemetry).toContain(
        `if (this.getOltp${signal}Endpoint() && hasHeaders) {`,
      );
    }

    delete process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"];
    expect(Telemetry.getHeaders()).toEqual({});
  });

  it("writes each header as name=value, several separated by ';', a value holding '=' as the exporter reads them", () => {
    const turnOn: string = section("## Turn them on");

    expect(turnOn).toContain(
      "Write each header as `name=value`, and separate several with `;`. A value may hold `=`.",
    );

    /*
     * A Basic Authorization value ends in base64 padding: the header is read
     * up to its first '=' as the name, and the rest, padding and all, as the
     * value - as the page promises.
     */
    process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"] =
      "Authorization=Basic dXNlcjpwYXNzd29yZA==;x-oneuptime-token=key";

    expect(Telemetry.getHeaders()).toEqual({
      Authorization: "Basic dXNlcjpwYXNzd29yZA==",
      "x-oneuptime-token": "key",
    });

    delete process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"];
  });

  it("lets the environment pick the temporality: the exporter is given none, and reads delta", () => {
    const exporterCall: string = balancedFrom(
      telemetry,
      telemetry.indexOf("(", telemetry.indexOf("new OTLPMetricExporter(")),
    );

    expect(exporterCall).not.toMatch(/temporality/i);
    expect(telemetry).toContain(
      'import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";',
    );

    // Resolved as Telemetry resolves it: from Common.
    const commonRequire: NodeJS.Require = createRequire(
      path.join(COMMON_DIR, "Server/Utils/Telemetry.ts"),
    );
    const { OTLPMetricExporter } = commonRequire(
      "@opentelemetry/exporter-metrics-otlp-proto",
    ) as {
      OTLPMetricExporter: new (config: { url: string }) => {
        selectAggregationTemporality: (instrumentType: string) => number;
        shutdown: () => Promise<void>;
      };
    };
    const { InstrumentType, AggregationTemporality } = commonRequire(
      "@opentelemetry/sdk-metrics",
    ) as {
      InstrumentType: Record<string, string>;
      AggregationTemporality: Record<string, number>;
    };
    const temporalities: () => Array<number> = (): Array<number> => {
      const exporter: {
        selectAggregationTemporality: (instrumentType: string) => number;
        shutdown: () => Promise<void>;
      } = new OTLPMetricExporter({ url: "http://localhost/v1/metrics" });
      const selected: Array<number> = [
        InstrumentType["COUNTER"] as string,
        InstrumentType["HISTOGRAM"] as string,
      ].map((instrumentType: string): number => {
        return exporter.selectAggregationTemporality(instrumentType);
      });

      void exporter.shutdown();

      return selected;
    };
    const setting: string = "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE";

    delete process.env[setting];
    expect(temporalities()).toEqual([
      AggregationTemporality["CUMULATIVE"],
      AggregationTemporality["CUMULATIVE"],
    ]);

    process.env[setting] = "delta";
    expect(temporalities()).toEqual([
      AggregationTemporality["DELTA"],
      AggregationTemporality["DELTA"],
    ]);

    delete process.env[setting];
    expect(PAGE.split(setting).length - 1).toBe(2);
  });

  it("names the chart's exporter values, which reach the app and worker deployments", () => {
    const values: string = readRepoFile(
      "HelmChart/Public/oneuptime/values.yaml",
    );
    const exporter: string = yamlBlock(values, "openTelemetryExporter");
    const helpers: string = readRepoFile(
      "HelmChart/Public/oneuptime/templates/_helpers.tpl",
    );
    const common: string = helpers.slice(
      helpers.indexOf('{{- define "oneuptime.env.common" }}'),
      helpers.indexOf(
        "{{- define",
        helpers.indexOf('"oneuptime.env.common"') + 1,
      ),
    );
    const kubernetes: string = tabPanel(
      section("## Turn them on"),
      "Kubernetes",
    );

    expect(kubernetes).toContain("openTelemetryExporter:\n  endpoint: ");
    expect(kubernetes).toContain("\n  headers: x-oneuptime-token=");
    expect(exporter).toMatch(/^ {2}endpoint:/m);
    expect(exporter).toMatch(/^ {2}headers:/m);
    expect(common).toContain(
      '- name: OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT\n  value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.endpoint }}',
    );
    expect(common).toContain(
      '- name: OPENTELEMETRY_EXPORTER_OTLP_HEADERS\n  value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.headers }}',
    );

    for (const service of ["app", "worker"]) {
      const template: string = readRepoFile(
        `HelmChart/Public/oneuptime/templates/${service}.yaml`,
      );

      expect(template).toContain('{{- include "oneuptime.env.common" . ');
      expect(template).toContain(
        `- name: DISABLE_TELEMETRY\n              value: {{ $.Values.${service}.disableTelemetryCollection | quote }}`,
      );
      expect(yamlBlock(values, service)).toMatch(
        /^ {2}disableTelemetryCollection: false$/m,
      );
      expect(kubernetes).toContain(`\`${service}.disableTelemetryCollection\``);
    }
  });

  it("names Docker Compose's settings as config.example.env and the compose file read them", () => {
    const example: string = readRepoFile("config.example.env");
    const base: string = readRepoFile("docker-compose.base.yml");
    const compose: string = tabPanel(
      section("## Turn them on"),
      "Docker Compose",
    );
    const settings: Array<string> = Array.from(
      compose.matchAll(/^([A-Z_]+)=/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(settings).toEqual([
      "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
      "DISABLE_TELEMETRY_FOR_APP",
    ]);

    for (const setting of settings) {
      expect(example).toMatch(new RegExp(`^${setting}=`, "m"));
    }

    expect(example).toMatch(/^DISABLE_TELEMETRY_FOR_APP=true$/m);
    expect(yamlBlock(base, "x-common-variables")).toContain(
      "  OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT: ${OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT}\n  OPENTELEMETRY_EXPORTER_OTLP_HEADERS: ${OPENTELEMETRY_EXPORTER_OTLP_HEADERS}",
    );
    expect(yamlBlock(base, "x-common-runtime-variables")).toContain(
      "<<: *common-variables",
    );

    const app: string = nestedYamlBlock(yamlBlock(base, "services"), "app");

    expect(app).toContain("<<: *common-runtime-variables");
    expect(app).toContain("DISABLE_TELEMETRY: ${DISABLE_TELEMETRY_FOR_APP}");
  });

  it("sends deltas from the chart's extraEnv, which a service's own list replaces, and from a compose override of the app service", () => {
    const values: string = readRepoFile(
      "HelmChart/Public/oneuptime/values.yaml",
    );
    const deltas: string = section("### Send deltas to a OneUptime project");

    expect(values).toMatch(/^extraEnv: \[\]$/m);

    for (const service of ["app", "worker"]) {
      expect(
        readRepoFile(`HelmChart/Public/oneuptime/templates/${service}.yaml`),
      ).toContain(
        `{{- with (default $.Values.extraEnv $.Values.${service}.extraEnv) }}`,
      );
      expect(yamlBlock(values, service)).toMatch(/^ {2}extraEnv: \[\]$/m);
      expect(deltas).toContain(`\`${service}.extraEnv\``);
    }

    expect(tabPanel(deltas, "Kubernetes")).toContain(
      "extraEnv:\n  - name: OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE\n    value: delta",
    );
    expect(tabPanel(deltas, "Docker Compose")).toContain(
      "services:\n  app:\n    environment:\n      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: delta",
    );
    // The app service runs the workers too, and is the one compose file's.
    expect(readRepoFile("docker-compose.yml")).toMatch(/^ {2}app:$/m);
  });
});

describe("the objectives", () => {
  const objectives: Array<string> = [
    "### On-call SMS reach Twilio",
    "### Pages go out within 30 seconds",
    "### Notifications sent later go out within 90 seconds",
    "### On-call SMS reach the phone",
  ];

  // The values each metric's attributes take, from what the page's tables list.
  const attributeValues: Record<string, Array<string>> = {
    "notification.channel": valuesOf(NotificationDeliveryChannel),
    "notification.provider.config": valuesOf(NotificationProviderConfig),
    "notification.on_call_page": ["true", "false"],
    "notification.page.start": valuesOf(OnCallPageStart),
    "notification.schedule": valuesOf(NotificationSchedule),
  };

  beforeEach(async () => {
    // One of each kind of record, so every metric's attribute names are known.
    await NotificationDeliveryMetrics.measureDispatch(
      {
        channel: NotificationDeliveryChannel.SMS,
        provider: NotificationDeliveryProvider.Twilio,
        isOnCallPage: true,
      },
      async (): Promise<void> => {},
    );
    NotificationDeliveryMetrics.recordTimeToSend({
      channel: NotificationDeliveryChannel.SMS,
      pageStart: OnCallPageStart.RecordCreated,
      timeToSendInMs: 900,
    });
    NotificationDeliveryMetrics.recordSendLag({
      channel: NotificationDeliveryChannel.SMS,
      schedule: NotificationSchedule.Escalation,
      lagInMs: 30000,
    });
    NotificationDeliveryMetrics.recordDelivery({
      channel: NotificationDeliveryChannel.SMS,
      provider: NotificationDeliveryProvider.Twilio,
      isOnCallPage: true,
      status: NotificationDeliveryStatus.Delivered,
    });
  });

  it("are the four the page's opening promises, each under its own heading", () => {
    for (const heading of objectives) {
      expect(PAGE.split("\n")).toContain(heading);
    }

    expect(section("## SLOs to start from")).toContain(
      "Four objectives most installations can promise",
    );
  });

  it("query metrics that exist, by an aggregation the explorer offers, filtered by real attributes and values", () => {
    const operators: Array<string> = DICTIONARY_FILTER_OPERATOR_OPTIONS.map(
      (option: { symbol: string }): string => {
        return option.symbol;
      },
    );
    const outcomes: Array<string> = [
      ...valuesOf(NotificationDeliveryOutcome),
      ...valuesOf(NotificationDeliveryStatus),
    ];

    for (const heading of objectives) {
      for (const row of onlyTable(heading)) {
        const metric: string = codeIn(row[1] as string)[0] as string;
        const aggregation: string = (row[2] as string).replace(/\*\*/g, "");
        const recorded: Array<string> = attributeNamesOn(metric);

        expect({ heading, metric, created: caught.has(metric) }).toEqual({
          heading,
          metric,
          created: true,
        });
        expect(valuesOf(MetricsAggregationType)).toContain(aggregation);

        for (const condition of codeIn(row[3] as string)) {
          const parts: RegExpMatchArray | null = condition.match(CONDITION);

          expect({ heading, condition, parsed: Boolean(parts) }).toEqual({
            heading,
            condition,
            parsed: true,
          });

          const [, attribute, operator, value] = parts as RegExpMatchArray;
          const known: Array<string> =
            attribute === "outcome"
              ? outcomes
              : attributeValues[attribute as string] || [];

          expect(operators).toContain(operator);
          expect({
            heading,
            attribute,
            recorded: recorded.includes(attribute as string),
          }).toEqual({
            heading,
            attribute,
            recorded: true,
          });
          expect({
            heading,
            condition,
            known: known.includes(value as string),
          }).toEqual({
            heading,
            condition,
            known: true,
          });
        }
      }
    }
  });

  it("read a percentile objective at a bucket edge of its histogram", () => {
    const edges: Array<[string, string, number]> = [
      [
        "### Pages go out within 30 seconds",
        "notification.time_to_send",
        30000,
      ],
      [
        "### Notifications sent later go out within 90 seconds",
        "notification.send.lag",
        90000,
      ],
    ];

    for (const [heading, metric, edge] of edges) {
      expect(section(heading)).toContain(
        `The objective holds while \`a\` stays at or below ${edge}.`,
      );
      expect(instrument(metric).buckets).toContain(edge);
    }

    expect(section("### Histogram buckets")).toContain(
      "a P95 of `notification.time_to_send` at or below 30000",
    );
  });

  it("write a failure share the formula evaluator reads, which draws no point for a step with no failures", () => {
    const formula: string = "$b / $a * 100";
    const queryConfig: (variable: string) => MetricQueryConfigData = (
      variable: string,
    ): MetricQueryConfigData => {
      return {
        metricAliasData: {
          metricVariable: variable,
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "notification.send.count",
            aggegationType: MetricsAggregationType.Sum,
          },
        },
      };
    };
    const result: (points: Array<[string, number]>) => AggregatedResult = (
      points: Array<[string, number]>,
    ): AggregatedResult => {
      return {
        data: points.map((point: [string, number]) => {
          return { timestamp: new Date(point[0]), value: point[1] };
        }),
      };
    };
    const shares: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: formula,
      queryConfigs: [queryConfig("a"), queryConfig("b")],
      formulaConfigs: [],
      results: [
        result([
          ["2026-11-01T00:00:00Z", 200],
          ["2026-11-01T00:01:00Z", 100],
        ]),
        // No failure in the first step: b has no point there.
        result([["2026-11-01T00:01:00Z", 2]]),
      ],
    });

    expect(
      shares.data.map((point: { value: number }): number => {
        return point.value;
      }),
    ).toEqual([2]);

    for (const heading of [
      "### On-call SMS reach Twilio",
      "### On-call SMS reach the phone",
    ]) {
      expect(section(heading)).toContain(`The formula \`${formula}\``);
    }

    expect(section("### On-call SMS reach Twilio")).toContain(
      "A step with no failure draws no point, as `b` has none.",
    );
  });

  it("name channels and statuses that exist when they say what to change", () => {
    const twilio: string = section("### On-call SMS reach Twilio");
    const phone: string = section("### On-call SMS reach the phone");
    const otherChannels: Array<string> = codeIn(
      twilio.slice(twilio.indexOf("For another channel")),
    ).slice(1);

    expect(otherChannels).toEqual(["call", "push", "email"]);

    for (const channel of otherChannels) {
      expect(valuesOf(NotificationDeliveryChannel)).toContain(channel);
    }

    expect(phone).toContain("For calls, use `call` and `outcome != answered`.");
    expect(valuesOf(NotificationDeliveryStatus)).toContain("answered");
  });

  /*
   * An installation that sends its SMS and calls through its own gateway
   * sends nothing through Twilio, and its gateway's messages are the
   * installation's own (global): the first objective's queries count them
   * as they count Twilio's, which the page says.
   */
  it("measure an installation's SMS and call gateway with the same queries, as its own account", async () => {
    expect(section("### On-call SMS reach Twilio")).toContain(
      "On an installation that sends SMS through its SMS and call gateway, the same queries measure the gateway.",
    );

    for (const service of ["SmsService", "CallService"]) {
      const source: string = readAppSource(
        `FeatureSet/Notification/Services/${service}.ts`,
      ).replace(WHITESPACE_RUN, " ");
      const dispatchStart: string = source.slice(
        source.indexOf("NotificationDeliveryMetrics.measureDispatch("),
        source.indexOf("async (dispatch: NotificationDispatch)"),
      );

      // Started with no account, so it is the installation's own (global).
      expect({ service, dispatchStart }).toEqual({
        service,
        dispatchStart: expect.not.stringContaining("providerConfig"),
      });
      // The gateway only where no project's own Twilio account is used...
      expect({ service, source }).toEqual({
        service,
        source: expect.stringContaining(
          "const gateway: CallAndSmsGateway | null = customTwilioConfig ? null : await getCallAndSmsGateway();",
        ),
      });
      // ...picked with no account of its own, and Twilio not used beside it.
      expect({ service, source }).toEqual({
        service,
        source: expect.stringContaining(
          "if (gateway) { dispatch.setProvider(NotificationDeliveryProvider.SmsAndCallGateway); }",
        ),
      });
      expect({ service, source }).toEqual({
        service,
        source: expect.stringContaining(
          "const twilioConfig: TwilioConfig | null = gateway ? null :",
        ),
      });
    }

    // Recorded as the first objective's conditions read it.
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.SMS,
        isOnCallPage: true,
      });

    dispatch.setProvider(NotificationDeliveryProvider.SmsAndCallGateway);
    dispatch.end(NotificationDeliveryOutcome.Failure);

    expect(recordedOn("notification.send.count").slice(-1)).toEqual([
      {
        "notification.channel": "sms",
        "notification.provider": "sms_and_call_gateway",
        "notification.provider.config": "global",
        "notification.on_call_page": "true",
        outcome: "failure",
      },
    ]);
  });
});

describe("the page's words", () => {
  it("names the Dashboard only by labels it draws", () => {
    const labels: Array<string> = [
      ...boldLabels(PAGE),
      ...boldPaths(PAGE).flat(),
    ];

    expect(labels.length).toBeGreaterThan(5);

    for (const label of labels) {
      expect({ label, drawn: isDashboardLabel(label) }).toEqual({
        label,
        drawn: true,
      });
    }
  });

  it("answers the three troubles the page lists, with the settings it names above", () => {
    const blocks: Array<{ summary: string; body: string }> =
      detailsBlocks(PAGE);

    expect(
      blocks.map((block: { summary: string }): string => {
        return block.summary;
      }),
    ).toEqual([
      "No notification metrics arrive",
      "A count only ever grows, or a percentile barely moves",
      "No final statuses arrive",
    ]);
    expect(blocks[0]?.body).toContain("`OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT`");
    expect(blocks[0]?.body).toContain("`OPENTELEMETRY_EXPORTER_OTLP_HEADERS`");
    expect(blocks[0]?.body).toContain("`DISABLE_TELEMETRY_FOR_APP`");
  });

  it("says OneUptime warns as it starts about a header it cannot read, and when it sends nothing, as Telemetry does", () => {
    const body: string = detailsBlocks(PAGE)[0]?.body || "";
    const telemetry: string = readCommonSource("Server/Utils/Telemetry.ts");
    const init: string = telemetry.slice(
      telemetry.indexOf("public static init("),
      telemetry.indexOf("public static getLogger("),
    );

    expect(body).toContain(
      "As it starts, OneUptime logs a warning when it cannot read a header, or when it sends nothing.",
    );

    /*
     * init reads the headers as getHeaders() does, and warns about one it
     * cannot read...
     */
    expect(init).toContain(
      "const headersRead: OtlpExporterHeaders = this.readHeaders();",
    );
    expect(telemetry).toContain(
      "const read: OtlpExporterHeaders = this.readHeaders();",
    );
    expect(init).toContain("this.warnAboutUnreadableHeaders(headersRead);");
    expect(telemetry).toContain(
      "const unreadable: string | null = describeUnreadableOtlpHeaders(read);",
    );
    expect(telemetry).toContain("logger.error(unreadable, EXTERNAL_FAULT);");

    // ...and says so when an endpoint is set but nothing is sent.
    expect(init).toContain("if (this.getOtlpEndpoint() && !hasHeaders) {");
    expect(init).toContain(
      "logger.error(NOTHING_EXPORTED_WITHOUT_A_HEADER, EXTERNAL_FAULT);",
    );
  });
});
