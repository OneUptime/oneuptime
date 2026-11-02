import Log from "../../../../../Models/AnalyticsModels/Log";
import Span from "../../../../../Models/AnalyticsModels/Span";
import LogService from "../../../../../Server/Services/LogService";
import SpanService from "../../../../../Server/Services/SpanService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../../Server/Utils/Logger";
import SecurityConnectedRecords from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import SecurityConnections from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import SecurityTelemetryMentions, {
  toTelemetryHitsJson,
} from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityTelemetryMentions";
import { PLACE_SEPARATOR } from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityTelemetryStatements";
import TelemetryReadAccess from "../../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../../../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES,
  SECURITY_TELEMETRY_MAX_LISTED,
  SECURITY_TELEMETRY_MESSAGE_PLACE,
  SecurityConnectionKind,
  SecurityTelemetryMentionsJson,
  SecurityTelemetrySignal,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../../Types/SecurityCase/SecurityEntity";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * "In your logs and traces": where a case's, an event's or an entity's
 * values appear in the project's logs and traces - each signal searched
 * with the caller's own telemetry scope, a signal the role cannot read or
 * whose read failed said to be (never a zero), the records that sent the
 * lines and spans named with the caller's role, the most first.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CHECKOUT_ID: string = "33333333-3333-4333-8333-333333333333";
const EDGE_ID: string = "44444444-4444-4444-8444-444444444444";
const UNNAMED_ID: string = "55555555-5555-4555-8555-555555555555";
const NOW: Date = new Date("2026-10-25T12:00:00.000Z");

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("66666666-6666-4666-8666-666666666666"),
  tenantId: PROJECT_ID,
};

const ENTITIES: Array<SecurityEntity> = [
  { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
  { type: SecurityEntityType.Domain, value: "evil.example" },
  // Never searched for.
  { type: SecurityEntityType.Host, value: "web-1" },
];

const WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-10-25T08:30:00.000Z"),
  end: new Date("2026-10-25T10:30:00.000Z"),
};

const NAMES: Map<string, { kind: SecurityConnectionKind; name: string }> =
  new Map([
    [
      `${SecurityConnectionKind.Service}:${CHECKOUT_ID}`,
      { kind: SecurityConnectionKind.Service, name: "checkout-api" },
    ],
    [
      `${SecurityConnectionKind.Host}:${EDGE_ID}`,
      { kind: SecurityConnectionKind.Host, name: "edge-1" },
    ],
  ]);

// The attacker in 1,284 log lines, the domain in none; the attacker in 312 spans.
const LOG_ROWS: Array<JSONObject> = [
  {
    valueIndex: 1,
    totalCount: "1284",
    messageTotal: "1200",
    lastSeenAt: "2026-10-25 10:12:00.000000000",
    sourceCount: "4",
    sources: [
      ["1100", ServiceType.OpenTelemetry, CHECKOUT_ID],
      ["120", ServiceType.OpenTelemetry, UNNAMED_ID],
      ["60", ServiceType.Host, EDGE_ID],
      ["4", ServiceType.Monitor, UNNAMED_ID],
    ],
    places: [[`client_ip${PLACE_SEPARATOR}203.0.113.7`], ["84"]],
  },
];

const SPAN_ROWS: Array<JSONObject> = [
  {
    valueIndex: 1,
    totalCount: "312",
    messageTotal: "0",
    lastSeenAt: "2026-10-25 10:20:00.000000000",
    sourceCount: "1",
    sources: [["312", ServiceType.OpenTelemetry, CHECKOUT_ID]],
    places: [
      [
        `client.address${PLACE_SEPARATOR}203.0.113.7`,
        `net.peer.ip${PLACE_SEPARATOR}203.0.113.7`,
      ],
      ["300", "12"],
    ],
  },
];

function answer(rows: Array<JSONObject>): never {
  return {
    json: async (): Promise<JSONObject> => {
      return { data: rows };
    },
  } as never;
}

let spies: {
  scope: jest.SpyInstance;
  logs: jest.SpyInstance;
  spans: jest.SpyInstance;
  names: jest.SpyInstance;
  error: jest.SpyInstance;
};

function search(
  entities: Array<SecurityEntity> = ENTITIES,
): Promise<SecurityTelemetryMentionsJson> {
  return SecurityTelemetryMentions.search({
    projectId: PROJECT_ID,
    entities,
    window: WINDOW,
    props: CALLER,
  });
}

beforeEach(() => {
  spies = {
    scope: jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockResolvedValue({}),
    logs: jest
      .spyOn(LogService, "executeQuery")
      .mockResolvedValue(answer(LOG_ROWS)),
    spans: jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue(answer(SPAN_ROWS)),
    names: jest
      .spyOn(SecurityConnectedRecords, "readNamesOfLogResources")
      .mockResolvedValue(NAMES),
    error: jest.spyOn(logger, "error").mockImplementation((): void => {}),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the search", () => {
  test("the values it names that are searched for, each with its log lines and spans", async () => {
    const mentions: SecurityTelemetryMentionsJson = await search();

    expect(mentions).toEqual({
      windowStart: WINDOW.start.toISOString(),
      windowEnd: WINDOW.end.toISOString(),
      values: [
        {
          entityType: SecurityEntityType.IpAddress,
          entityValue: "203.0.113.7",
          logs: {
            count: 1284,
            sources: [
              {
                kind: SecurityConnectionKind.Service,
                id: CHECKOUT_ID,
                name: "checkout-api",
                count: 1100,
              },
              {
                kind: SecurityConnectionKind.Host,
                id: EDGE_ID,
                name: "edge-1",
                count: 60,
              },
            ],
            // A service the reader cannot name, and a monitor's logs: counted, not listed.
            sourceCount: 4,
            places: [
              { key: SECURITY_TELEMETRY_MESSAGE_PLACE, count: 1200 },
              { key: "client_ip", count: 84, value: "203.0.113.7" },
            ],
            lastSeen: "2026-10-25T10:12:00.000Z",
          },
          traces: {
            count: 312,
            sources: [
              {
                kind: SecurityConnectionKind.Service,
                id: CHECKOUT_ID,
                name: "checkout-api",
                count: 312,
              },
            ],
            sourceCount: 1,
            places: [
              { key: "client.address", count: 300, value: "203.0.113.7" },
              { key: "net.peer.ip", count: 12, value: "203.0.113.7" },
            ],
            lastSeen: "2026-10-25T10:20:00.000Z",
          },
        },
        // Searched in both, named by neither: read, and none.
        {
          entityType: SecurityEntityType.Domain,
          entityValue: "evil.example",
          logs: {
            count: 0,
            sources: [],
            sourceCount: 0,
            places: [],
            lastSeen: null,
          },
          traces: {
            count: 0,
            sources: [],
            sourceCount: 0,
            places: [],
            lastSeen: null,
          },
        },
      ],
      hasMoreValues: false,
      unreadableSignals: [],
      failedSignals: [],
    });
  });

  test("each signal with the caller's own scope of it, one read each", async () => {
    const hidden: TelemetryServiceFilter = {
      excludedServiceIds: [new ObjectID(UNNAMED_ID)],
    };

    spies.scope.mockResolvedValue(hidden);

    await search();

    expect(spies.scope).toHaveBeenCalledTimes(2);
    expect(spies.scope).toHaveBeenCalledWith({ modelType: Log, props: CALLER });
    expect(spies.scope).toHaveBeenCalledWith({
      modelType: Span,
      props: CALLER,
    });
    expect(spies.logs).toHaveBeenCalledTimes(1);
    expect(spies.spans).toHaveBeenCalledTimes(1);

    const logStatement: Statement = spies.logs.mock.calls[0]![0] as Statement;
    const spanStatement: Statement = spies.spans.mock.calls[0]![0] as Statement;

    expect(logStatement.query).toContain("primaryEntityId NOT IN (");
    expect(logStatement.query).toContain(`.${new Log().tableName} `);
    expect(spanStatement.query).toContain(`.${new Span().tableName} `);
    expect(Object.values(logStatement.query_params)).toContain(
      PROJECT_ID.toString(),
    );
  });

  test("the records are named once for both signals, with the caller's role", async () => {
    await search();

    expect(spies.names).toHaveBeenCalledTimes(1);

    const args: {
      projectId: ObjectID;
      resources: Array<{ type: string; id: string }>;
      props: DatabaseCommonInteractionProps;
    } = spies.names.mock.calls[0]![0] as never;

    expect(args.projectId).toBe(PROJECT_ID);
    expect(args.props).toBe(CALLER);
    expect(args.resources).toEqual([
      { type: ServiceType.OpenTelemetry, id: CHECKOUT_ID },
      { type: ServiceType.OpenTelemetry, id: UNNAMED_ID },
      { type: ServiceType.Host, id: EDGE_ID },
      { type: ServiceType.Monitor, id: UNNAMED_ID },
      { type: ServiceType.OpenTelemetry, id: CHECKOUT_ID },
    ]);
  });

  test("a case that names nothing searched for reads nothing", async () => {
    const mentions: SecurityTelemetryMentionsJson = await search([
      { type: SecurityEntityType.Host, value: "web-1" },
      { type: SecurityEntityType.User, value: "root" },
    ]);

    expect(mentions.values).toEqual([]);
    expect(mentions.hasMoreValues).toBe(false);
    expect(spies.scope).not.toHaveBeenCalled();
    expect(spies.logs).not.toHaveBeenCalled();
    expect(spies.spans).not.toHaveBeenCalled();
    expect(spies.names).not.toHaveBeenCalled();
  });

  test("it says when it names more values than are searched for", async () => {
    const many: Array<SecurityEntity> = [];

    for (let index: number = 1; index <= 12; index++) {
      many.push({
        type: SecurityEntityType.IpAddress,
        value: `198.51.100.${index}`,
      });
    }

    spies.logs.mockResolvedValue(answer([]));
    spies.spans.mockResolvedValue(answer([]));

    const mentions: SecurityTelemetryMentionsJson = await search(many);

    expect(mentions.values.length).toBe(10);
    expect(mentions.hasMoreValues).toBe(true);
    // Nothing came back: no record to name.
    expect(spies.names).not.toHaveBeenCalled();
  });

  test("a signal the role cannot read is said to be, never searched, never counted; the other still is", async () => {
    spies.scope.mockImplementation(
      async (data: { modelType: unknown }): Promise<TelemetryServiceFilter> => {
        if (data.modelType === Log) {
          throw new NotAuthorizedException("no logs for you");
        }

        return {};
      },
    );

    const mentions: SecurityTelemetryMentionsJson = await search();

    expect(mentions.unreadableSignals).toEqual([SecurityTelemetrySignal.Logs]);
    expect(mentions.failedSignals).toEqual([]);
    expect(spies.logs).not.toHaveBeenCalled();
    expect(mentions.values[0]!.logs).toBeNull();
    expect(mentions.values[0]!.traces!.count).toBe(312);
    // The domain: not searched in the logs, so not said to be in neither.
    expect(mentions.values[1]!.logs).toBeNull();
    expect(mentions.values[1]!.traces!.count).toBe(0);
    expect(spies.error).not.toHaveBeenCalled();
  });

  test("a plan that does not include it is a refusal too", async () => {
    spies.scope.mockRejectedValue(new PaymentRequiredException("upgrade"));

    const mentions: SecurityTelemetryMentionsJson = await search();

    expect(mentions.unreadableSignals).toEqual([
      SecurityTelemetrySignal.Logs,
      SecurityTelemetrySignal.Traces,
    ]);
    expect(mentions.values[0]!.logs).toBeNull();
    expect(mentions.values[0]!.traces).toBeNull();
    expect(spies.names).not.toHaveBeenCalled();
  });

  test("a read that fails or runs out of time is said to have failed, never an empty answer", async () => {
    spies.spans.mockRejectedValue(new Error("TIMEOUT_EXCEEDED"));

    const mentions: SecurityTelemetryMentionsJson = await search();

    expect(mentions.failedSignals).toEqual([SecurityTelemetrySignal.Traces]);
    expect(mentions.unreadableSignals).toEqual([]);
    expect(mentions.values[0]!.traces).toBeNull();
    expect(mentions.values[0]!.logs!.count).toBe(1284);
    expect(spies.error).toHaveBeenCalledTimes(1);
    expect(String(spies.error.mock.calls[0]![0])).toContain("traces");
  });

  test(`at most ${SECURITY_TELEMETRY_MAX_LISTED} records listed, the most first`, async () => {
    const ids: Array<string> = [
      "77777777-7777-4777-8777-777777777771",
      "77777777-7777-4777-8777-777777777772",
      "77777777-7777-4777-8777-777777777773",
      "77777777-7777-4777-8777-777777777774",
    ];

    spies.logs.mockResolvedValue(
      answer([
        {
          valueIndex: 1,
          totalCount: 10,
          messageTotal: 10,
          sourceCount: 4,
          sources: ids.map((id: string, index: number): Array<unknown> => {
            return [4 - index, ServiceType.OpenTelemetry, id];
          }),
          places: [[], []],
        },
      ]),
    );
    spies.names.mockResolvedValue(
      new Map(
        ids.map(
          (
            id: string,
            index: number,
          ): [string, { kind: SecurityConnectionKind; name: string }] => {
            return [
              `${SecurityConnectionKind.Service}:${id}`,
              {
                kind: SecurityConnectionKind.Service,
                name: `service-${index + 1}`,
              },
            ];
          },
        ),
      ),
    );

    const mentions: SecurityTelemetryMentionsJson = await search();

    expect(
      mentions.values[0]!.logs!.sources.map(
        (source: { name: string }): string => {
          return source.name;
        },
      ),
    ).toEqual(["service-1", "service-2", "service-3"]);
    expect(mentions.values[0]!.logs!.sourceCount).toBe(4);
  });
});

describe("a value's hits", () => {
  test("none read is none, never missing", () => {
    expect(toTelemetryHitsJson(undefined, NAMES)).toEqual({
      count: 0,
      sources: [],
      sourceCount: 0,
      places: [],
      lastSeen: null,
    });
  });
});

describe("a case's, an event's and an entity's", () => {
  test("a case: its own entities over its own window, read as the caller; a case not theirs to read is none", async () => {
    const window: jest.SpyInstance = jest
      .spyOn(SecurityConnections, "readCaseWindow")
      .mockResolvedValue({ entities: ENTITIES, window: WINDOW });

    const mentions: SecurityTelemetryMentionsJson | null =
      await SecurityTelemetryMentions.forCase({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: CALLER,
        now: NOW,
      });

    expect(window).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    });
    expect(mentions?.windowStart).toBe(WINDOW.start.toISOString());
    expect(mentions?.values.length).toBe(2);

    window.mockResolvedValue(null);

    expect(
      await SecurityTelemetryMentions.forCase({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: CALLER,
      }),
    ).toBeNull();
  });

  test("an event's: the hour around it; a time after now is now", async () => {
    const at: Date = new Date("2026-10-25T09:00:00.000Z");
    const around: SecurityTelemetryMentionsJson =
      await SecurityTelemetryMentions.forEntities({
        projectId: PROJECT_ID,
        entities: ENTITIES,
        time: at,
        props: CALLER,
        now: NOW,
      });

    expect(around.windowStart).toBe(
      new Date(
        at.getTime() - SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES * 60000,
      ).toISOString(),
    );
    expect(around.windowEnd).toBe(
      new Date(
        at.getTime() + SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES * 60000,
      ).toISOString(),
    );

    const future: SecurityTelemetryMentionsJson =
      await SecurityTelemetryMentions.forEntities({
        projectId: PROJECT_ID,
        entities: ENTITIES,
        time: new Date("2027-01-01T00:00:00.000Z"),
        props: CALLER,
        now: NOW,
      });

    expect(future.windowEnd).toBe(NOW.toISOString());
    expect(future.windowStart).toBe(
      new Date(
        NOW.getTime() - SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES * 60000,
      ).toISOString(),
    );
  });
});
