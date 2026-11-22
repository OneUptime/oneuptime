import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import ExceptionSavedView from "../../../../Models/DatabaseModels/ExceptionSavedView";
import LogRecordingRule from "../../../../Models/DatabaseModels/LogRecordingRule";
import LogSavedView from "../../../../Models/DatabaseModels/LogSavedView";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import TraceRecordingRule from "../../../../Models/DatabaseModels/TraceRecordingRule";
import TraceSavedView from "../../../../Models/DatabaseModels/TraceSavedView";
import DashboardService from "../../../../Server/Services/DashboardService";
import ExceptionSavedViewService from "../../../../Server/Services/ExceptionSavedViewService";
import LogRecordingRuleService from "../../../../Server/Services/LogRecordingRuleService";
import LogSavedViewService from "../../../../Server/Services/LogSavedViewService";
import MonitorService from "../../../../Server/Services/MonitorService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import TraceRecordingRuleService from "../../../../Server/Services/TraceRecordingRuleService";
import TraceSavedViewService from "../../../../Server/Services/TraceSavedViewService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import logger from "../../../../Server/Utils/Logger";
import {
  findTelemetryFieldReaders,
  MAX_READS_PER_READER,
} from "../../../../Server/Utils/Telemetry/TelemetryFieldReaders";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import {
  TelemetryFieldPart,
  TelemetryFieldReader,
  TelemetryFieldReaderKind,
  TelemetryFieldReaderList,
  TelemetryFieldReadersByKind,
  TelemetryFieldUse,
} from "../../../../Types/Telemetry/TelemetryFieldReaders";
import { TelemetryFieldReference } from "../../../../Utils/Telemetry/TelemetryFieldReferences";

/*
 * WHICH SAVED RECORDS READ A LOG'S OR A SPAN'S FIELDS (#10433).
 *
 * Every kind of record that reads logs or spans is read as the server and
 * asked, field by field, whether it reads what a change takes away: each
 * such record named where the person asking may read it, counted where
 * they may not, and a kind that could not be read said to be unchecked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000104330",
);
const USER_ID: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-000000104331");
const CHECKOUT: string = "0192f1a0-0000-7000-8000-00000010433a";
const PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

// What the change takes away in these tests: user.email, read any way.
function readsUserEmail(reference: TelemetryFieldReference): boolean {
  return (reference.key || "").toLowerCase() === "user.email";
}

type AnyFindBy = FindBy<any>;

/*
 * A table's records as the server reads them (isRoot), and the ones the
 * person may read, as their own read answers: those `visible` keeps of the
 * ids asked for - or an error their read throws.
 */
function serve<T extends { id?: ObjectID | null }>(
  service: { findBy: (findBy: AnyFindBy) => Promise<Array<T>> },
  data: {
    all: Array<T> | Error;
    visible?: ((record: T) => boolean) | Error;
  },
): void {
  jest
    .spyOn(service as never, "findBy" as never)
    .mockImplementation((async (findBy: AnyFindBy): Promise<Array<T>> => {
      if (findBy.props.isRoot) {
        if (data.all instanceof Error) {
          throw data.all;
        }

        return data.all;
      }

      if (data.visible instanceof Error) {
        throw data.visible;
      }

      // QueryHelper.any: a Raw operator holding the ids as its parameter.
      const operator: {
        objectLiteralParameters?: Record<string, Array<string>>;
      } = (findBy.query as Record<string, unknown>)["_id"] as {
        objectLiteralParameters?: Record<string, Array<string>>;
      };
      const asked: Array<string> = Object.values(
        operator.objectLiteralParameters || {},
      )
        .flat()
        .map((id: string): string => {
          return id.toString().toLowerCase();
        });

      return (data.all as Array<T>).filter((record: T): boolean => {
        return (
          asked.includes(record.id!.toString().toLowerCase()) &&
          (data.visible
            ? (data.visible as (record: T) => boolean)(record)
            : true)
        );
      });
    }) as never);
}

function logMonitor(name: string, attributes: Record<string, unknown>): Monitor {
  const monitor: Monitor = new Monitor(ObjectID.generate());

  monitor.name = name;
  (monitor as unknown as { monitorSteps: unknown }).monitorSteps = {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [{ data: { logMonitor: { attributes } } }],
    },
  };

  return monitor;
}

function boardOf(name: string): Dashboard {
  const dashboard: Dashboard = new Dashboard(ObjectID.generate());

  dashboard.name = name;
  dashboard.dashboardViewConfig = {
    _type: "DashboardViewConfig",
    components: [
      {
        _type: "DashboardComponent",
        componentId: {
          _type: "ObjectID",
          value: "0192f1a0-0000-7000-8000-0000001043d1",
        },
        componentType: DashboardComponentType.LogChart,
        arguments: {
          chartTitle: "Sign-ins by user",
          attributeFilters: { "user.email": "alice@example.com" },
        },
      },
      {
        _type: "DashboardComponent",
        componentId: {
          _type: "ObjectID",
          value: "0192f1a0-0000-7000-8000-0000001043d2",
        },
        componentType: DashboardComponentType.LogChart,
        arguments: { chartTitle: "Errors", bodyContains: "error" },
      },
    ],
  } as never;

  return dashboard;
}

function logView(name: string): LogSavedView {
  const view: LogSavedView = new LogSavedView(ObjectID.generate());

  view.name = name;
  view.query = { attributes: { "user.email": "alice@example.com" } } as never;

  return view;
}

function traceView(name: string): TraceSavedView {
  const view: TraceSavedView = new TraceSavedView(ObjectID.generate());

  view.name = name;
  view.query = { search: "@user.email:alice@example.com" };

  return view;
}

function exceptionView(name: string): ExceptionSavedView {
  const view: ExceptionSavedView = new ExceptionSavedView(ObjectID.generate());

  view.name = name;
  view.query = { filters: [["attributes.user.email", "a@b.co"]] };

  return view;
}

function logRule(name: string): LogRecordingRule {
  const rule: LogRecordingRule = new LogRecordingRule(ObjectID.generate());

  rule.name = name;
  rule.definition = {
    filter: {},
    aggregationType: AggregationType.Count,
    groupByAttributes: ["user.email"],
  };

  return rule;
}

function traceRule(name: string): TraceRecordingRule {
  const rule: TraceRecordingRule = new TraceRecordingRule(ObjectID.generate());

  rule.name = name;
  rule.definition = {
    sources: [],
    expression: "A",
    groupByAttribute: "user.email",
  } as never;

  return rule;
}

function sloOf(name: string): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(
    ObjectID.generate(),
  );

  slo.name = name;
  slo.sliType = SliType.RequestSuccess;
  slo.requestFilter = "@user.email:alice@example.com";
  slo.services = [new Service(new ObjectID(CHECKOUT))];

  return slo;
}

function names(readers: Array<TelemetryFieldReader>): Array<string> {
  return readers.map((reader: TelemetryFieldReader): string => {
    return reader.name;
  });
}

beforeEach(() => {
  serve(MonitorService, {
    all: [
      logMonitor("VIP sign-in failures", { "user.email": "vip@example.com" }),
      logMonitor("Checkout errors", { "http.route": "/checkout" }),
    ],
  });
  serve(DashboardService, { all: [boardOf("Sign-ins")] });
  serve(LogSavedViewService, { all: [logView("Alice's logs")] });
  serve(TraceSavedViewService, { all: [traceView("Alice's requests")] });
  serve(ExceptionSavedViewService, { all: [exceptionView("Alice's errors")] });
  serve(LogRecordingRuleService, { all: [logRule("Sign-ins per user")] });
  serve(TraceRecordingRuleService, { all: [traceRule("Requests per user")] });
  serve(ServiceLevelObjectiveService, { all: [sloOf("Alice's success")] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function readers(): Promise<TelemetryFieldReadersByKind> {
  return await findTelemetryFieldReaders({
    projectId: PROJECT_ID,
    reads: readsUserEmail,
    props: PROPS,
  });
}

describe("every kind of record that reads a field", () => {
  test("monitors, dashboards, saved views, recording rules and SLOs are found by what they read", async () => {
    const answer: TelemetryFieldReadersByKind = await readers();

    expect(names(answer[TelemetryFieldReaderKind.Monitor].readers)).toEqual([
      "VIP sign-in failures",
    ]);
    expect(names(answer[TelemetryFieldReaderKind.Dashboard].readers)).toEqual([
      "Sign-ins",
    ]);
    expect(names(answer[TelemetryFieldReaderKind.SavedView].readers)).toEqual([
      "Alice's errors",
      "Alice's logs",
      "Alice's requests",
    ]);
    expect(
      names(answer[TelemetryFieldReaderKind.RecordingRule].readers),
    ).toEqual(["Requests per user", "Sign-ins per user"]);
    expect(
      names(answer[TelemetryFieldReaderKind.ServiceLevelObjective].readers),
    ).toEqual(["Alice's success"]);

    for (const kind of Object.values(TelemetryFieldReaderKind)) {
      expect(answer[kind].isChecked).toBe(true);
      expect(answer[kind].hiddenCount).toBe(0);
    }
  });

  test("each reader says what it reads of the field, and which list it is in", async () => {
    const answer: TelemetryFieldReadersByKind = await readers();
    const monitor: TelemetryFieldReader =
      answer[TelemetryFieldReaderKind.Monitor].readers[0]!;
    const rules: Array<TelemetryFieldReader> =
      answer[TelemetryFieldReaderKind.RecordingRule].readers;

    expect(monitor.reads).toEqual([
      {
        part: TelemetryFieldPart.Attributes,
        key: "user.email",
        use: TelemetryFieldUse.Filter,
      },
    ]);
    expect(
      rules.map((rule: TelemetryFieldReader) => {
        return [rule.list, rule.reads[0]!.use];
      }),
    ).toEqual([
      [TelemetryFieldReaderList.Traces, TelemetryFieldUse.GroupBy],
      [TelemetryFieldReaderList.Logs, TelemetryFieldUse.GroupBy],
    ]);
    expect(
      answer[TelemetryFieldReaderKind.SavedView].readers.map(
        (view: TelemetryFieldReader) => {
          return view.list;
        },
      ),
    ).toEqual([
      TelemetryFieldReaderList.Exceptions,
      TelemetryFieldReaderList.Logs,
      TelemetryFieldReaderList.Traces,
    ]);
  });

  test("a dashboard names the widgets that read it, not the others", async () => {
    const answer: TelemetryFieldReadersByKind = await readers();

    expect(answer[TelemetryFieldReaderKind.Dashboard].readers[0]!.widgets).toEqual(
      [
        {
          id: "0192f1a0-0000-7000-8000-0000001043d1",
          title: "Sign-ins by user",
          type: DashboardComponentType.LogChart,
        },
      ],
    );
  });

  test("a reader says the first few of what it reads, each once", async () => {
    jest.restoreAllMocks();
    serve(MonitorService, {
      all: [
        logMonitor("Every way", {
          "user.email": "a@b.co",
          "User.Email": "c@d.co",
        }),
      ],
    });
    serve(DashboardService, { all: [] });
    serve(LogSavedViewService, { all: [] });
    serve(TraceSavedViewService, { all: [] });
    serve(ExceptionSavedViewService, { all: [] });
    serve(LogRecordingRuleService, { all: [] });
    serve(TraceRecordingRuleService, { all: [] });
    serve(ServiceLevelObjectiveService, { all: [] });

    const answer: TelemetryFieldReadersByKind = await readers();
    const reader: TelemetryFieldReader =
      answer[TelemetryFieldReaderKind.Monitor].readers[0]!;

    expect(reader.reads).toHaveLength(1);
    expect(reader.reads.length).toBeLessThanOrEqual(MAX_READS_PER_READER);
  });
});

describe("named only where the person may read them", () => {
  test("records they may not read are counted, never named", async () => {
    jest.restoreAllMocks();
    serve(MonitorService, {
      all: [
        logMonitor("Theirs", { "user.email": "a@b.co" }),
        logMonitor("Mine", { "user.email": "c@d.co" }),
      ],
      visible: (monitor: Monitor): boolean => {
        return monitor.name === "Mine";
      },
    });
    serve(DashboardService, { all: [boardOf("Sign-ins")], visible: () => false });
    serve(LogSavedViewService, { all: [] });
    serve(TraceSavedViewService, { all: [] });
    serve(ExceptionSavedViewService, { all: [] });
    serve(LogRecordingRuleService, { all: [] });
    serve(TraceRecordingRuleService, { all: [] });
    serve(ServiceLevelObjectiveService, { all: [] });

    const answer: TelemetryFieldReadersByKind = await readers();

    expect(names(answer[TelemetryFieldReaderKind.Monitor].readers)).toEqual([
      "Mine",
    ]);
    expect(answer[TelemetryFieldReaderKind.Monitor].hiddenCount).toBe(1);
    expect(answer[TelemetryFieldReaderKind.Dashboard].readers).toEqual([]);
    expect(answer[TelemetryFieldReaderKind.Dashboard].hiddenCount).toBe(1);
  });

  test("a role that may read none of a kind counts them all", async () => {
    jest.restoreAllMocks();
    serve(MonitorService, {
      all: [logMonitor("Theirs", { "user.email": "a@b.co" })],
      visible: new NotAuthorizedException("no"),
    });
    serve(DashboardService, { all: [] });
    serve(LogSavedViewService, { all: [] });
    serve(TraceSavedViewService, { all: [] });
    serve(ExceptionSavedViewService, { all: [] });
    serve(LogRecordingRuleService, { all: [] });
    serve(TraceRecordingRuleService, { all: [] });
    serve(ServiceLevelObjectiveService, { all: [] });

    const answer: TelemetryFieldReadersByKind = await readers();

    expect(answer[TelemetryFieldReaderKind.Monitor]).toEqual({
      readers: [],
      hiddenCount: 1,
      isChecked: true,
    });
  });
});

describe("what could not be read is said, never taken for nothing", () => {
  test("a table that cannot be read leaves its kind unchecked; the kind's other tables still answer", async () => {
    jest.restoreAllMocks();
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    serve(MonitorService, { all: new Error("Postgres went away") });
    serve(DashboardService, { all: [] });
    serve(LogSavedViewService, { all: new Error("Postgres went away") });
    serve(TraceSavedViewService, { all: [traceView("Alice's requests")] });
    serve(ExceptionSavedViewService, { all: [] });
    serve(LogRecordingRuleService, { all: [] });
    serve(TraceRecordingRuleService, { all: [] });
    serve(ServiceLevelObjectiveService, { all: [] });

    const answer: TelemetryFieldReadersByKind = await readers();

    expect(answer[TelemetryFieldReaderKind.Monitor]).toEqual({
      readers: [],
      hiddenCount: 0,
      isChecked: false,
    });
    expect(answer[TelemetryFieldReaderKind.SavedView].isChecked).toBe(false);
    expect(names(answer[TelemetryFieldReaderKind.SavedView].readers)).toEqual([
      "Alice's requests",
    ]);
    expect(answer[TelemetryFieldReaderKind.Dashboard].isChecked).toBe(true);
  });

  test("a person's own read that fails, not by their role, leaves the kind unchecked", async () => {
    jest.restoreAllMocks();
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    serve(MonitorService, {
      all: [logMonitor("Theirs", { "user.email": "a@b.co" })],
      visible: new Error("timeout"),
    });
    serve(DashboardService, { all: [] });
    serve(LogSavedViewService, { all: [] });
    serve(TraceSavedViewService, { all: [] });
    serve(ExceptionSavedViewService, { all: [] });
    serve(LogRecordingRuleService, { all: [] });
    serve(TraceRecordingRuleService, { all: [] });
    serve(ServiceLevelObjectiveService, { all: [] });

    const answer: TelemetryFieldReadersByKind = await readers();

    expect(answer[TelemetryFieldReaderKind.Monitor].isChecked).toBe(false);
    expect(answer[TelemetryFieldReaderKind.Monitor].readers).toEqual([]);
  });

  test("a question that throws on a field is no reader", async () => {
    const answer: TelemetryFieldReadersByKind = await findTelemetryFieldReaders(
      {
        projectId: PROJECT_ID,
        reads: (): boolean => {
          throw new Error("bad question");
        },
        props: PROPS,
      },
    );

    expect(answer[TelemetryFieldReaderKind.Monitor].readers).toEqual([]);
    expect(answer[TelemetryFieldReaderKind.Monitor].isChecked).toBe(true);
  });
});
