import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceOpenRecords, {
  WorkspaceOpenRecord,
  WorkspaceOpenRecordKind,
  WorkspaceOpenRecordList,
} from "../../../../Server/Utils/Workspace/WorkspaceOpenRecords";
import { WorkspaceAnswer } from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceMessageTime from "../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT IS OPEN RIGHT NOW, AS THE ASKER MAY SEE IT (WorkspaceOpenRecords).
 *
 * The Microsoft Teams bot's four lists - "show active incidents", "show
 * active alerts", "show scheduled maintenance", "show ongoing maintenance"
 * - read as OneUptime itself, so anybody in a connected Microsoft 365
 * organization could list a project's open incidents, connected to
 * OneUptime or not, whatever their role. They read as the member now, and
 * the Home of the OneUptime app in Slack and in Teams reads the same lists.
 * These pin the reads (the asker's props, the project, the open states, one
 * more than shown to tell there are more) and every line the lists say.
 */

const DASHBOARD: string = "https://oneuptime.test/dashboard";
const PROJECT_ID: ObjectID = new ObjectID(
  "f0000000-0000-4000-8000-000000000001",
);
const ASKER: ObjectID = new ObjectID("f0000000-0000-4000-8000-0000000000a1");

const PROPS: DatabaseCommonInteractionProps = {
  userId: ASKER,
  tenantId: PROJECT_ID,
};

const OPEN_INCIDENT_STATE: ObjectID = ObjectID.generate();
const OPEN_ALERT_STATE: ObjectID = ObjectID.generate();
const WAITING_STATES: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];
const IN_PROGRESS_STATES: Array<ObjectID> = [ObjectID.generate()];

const DECLARED: Date = new Date("2026-10-08T17:15:00.000Z");
const STARTS: Date = new Date("2026-10-09T02:00:00.000Z");
const ENDS: Date = new Date("2026-10-09T04:00:00.000Z");

let recordNumber: number = 0;

function nextId(): ObjectID {
  recordNumber++;
  return new ObjectID(
    `f0000000-0000-4000-8000-${String(recordNumber).padStart(12, "0")}`,
  );
}

function incident(data: {
  number: number;
  title: string;
  severity?: string | undefined;
  state?: string | undefined;
  declaredAt?: Date | undefined;
}): Incident {
  const row: Incident = new Incident();
  row.id = nextId();
  row.incidentNumber = data.number;
  row.incidentNumberWithPrefix = `INC-${data.number}`;
  row.title = data.title;

  if (data.severity) {
    row.incidentSeverity = { name: data.severity } as never;
  }

  if (data.state) {
    row.currentIncidentState = { name: data.state } as never;
  }

  if (data.declaredAt) {
    row.declaredAt = data.declaredAt;
  }

  return row;
}

function alert(data: {
  number: number;
  title: string;
  severity?: string | undefined;
  state?: string | undefined;
  createdAt?: Date | undefined;
}): Alert {
  const row: Alert = new Alert();
  row.id = nextId();
  row.alertNumber = data.number;
  row.alertNumberWithPrefix = `AL-${data.number}`;
  row.title = data.title;

  if (data.severity) {
    row.alertSeverity = { name: data.severity } as never;
  }

  if (data.state) {
    row.currentAlertState = { name: data.state } as never;
  }

  if (data.createdAt) {
    row.createdAt = data.createdAt;
  }

  return row;
}

function maintenance(data: {
  number: number;
  title: string;
  state?: string | undefined;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
}): ScheduledMaintenance {
  const row: ScheduledMaintenance = new ScheduledMaintenance();
  row.id = nextId();
  row.scheduledMaintenanceNumber = data.number;
  row.scheduledMaintenanceNumberWithPrefix = `SM-${data.number}`;
  row.title = data.title;

  if (data.state) {
    row.currentScheduledMaintenanceState = { name: data.state } as never;
  }

  if (data.startsAt) {
    row.startsAt = data.startsAt;
  }

  if (data.endsAt) {
    row.endsAt = data.endsAt;
  }

  return row;
}

function linkOf(path: string, row: { id: ObjectID | null }): string {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/${path}/${row.id!.toString()}`;
}

function at(date: Date): string {
  return WorkspaceMessageTime.dateAndTime(date).toString();
}

let incidentFind: SpyInstance<typeof IncidentService.findBy>;
let alertFind: SpyInstance<typeof AlertService.findBy>;
let maintenanceFind: SpyInstance<typeof ScheduledMaintenanceService.findBy>;

beforeEach(() => {
  recordNumber = 0;
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([OPEN_INCIDENT_STATE]);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([OPEN_ALERT_STATE]);
  jest
    .spyOn(
      ScheduledMaintenanceStateService,
      "getWaitingToStartScheduledMaintenanceStateIds",
    )
    .mockResolvedValue(WAITING_STATES);
  jest
    .spyOn(
      ScheduledMaintenanceStateService,
      "getInProgressScheduledMaintenanceStateIds",
    )
    .mockResolvedValue(IN_PROGRESS_STATES);
  incidentFind = jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
  alertFind = jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
  maintenanceFind = jest
    .spyOn(ScheduledMaintenanceService, "findBy")
    .mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The ids an "any of" query condition asks for.
function idsAskedFor(condition: unknown): Array<string> {
  const values: Array<unknown> =
    (Object.values(
      (condition as { objectLiteralParameters?: JSONObject })
        .objectLiteralParameters || {},
    )[0] as Array<unknown> | undefined) || [];

  return values
    .map((value: unknown): string => {
      return String(value);
    })
    .sort();
}

describe("the reads: the asker's own props, this project, the open states", () => {
  test("incidents: read as the member, never as OneUptime, newest first, one more than shown", async () => {
    await WorkspaceOpenRecords.read({
      kind: WorkspaceOpenRecordKind.Incidents,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(incidentFind).toHaveBeenCalledTimes(1);

    const read: JSONObject = incidentFind.mock.calls[0]![0] as never;

    expect(read["props"]).toBe(PROPS);
    expect((read["props"] as JSONObject)["isRoot"]).toBeUndefined();
    expect(String((read["query"] as JSONObject)["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(
      idsAskedFor((read["query"] as JSONObject)["currentIncidentStateId"]),
    ).toEqual([OPEN_INCIDENT_STATE.toString()]);
    expect(read["sort"]).toEqual({
      declaredAt: SortOrder.Descending,
      createdAt: SortOrder.Descending,
    });
    expect(read["limit"]).toBe(WorkspaceOpenRecords.MAX_RECORDS + 1);
    expect(read["skip"]).toBe(0);
  });

  test("alerts: read as the member, newest first", async () => {
    await WorkspaceOpenRecords.read({
      kind: WorkspaceOpenRecordKind.Alerts,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    const read: JSONObject = alertFind.mock.calls[0]![0] as never;

    expect(read["props"]).toBe(PROPS);
    expect(String((read["query"] as JSONObject)["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(
      idsAskedFor((read["query"] as JSONObject)["currentAlertStateId"]),
    ).toEqual([OPEN_ALERT_STATE.toString()]);
    expect(read["sort"]).toEqual({ createdAt: SortOrder.Descending });
  });

  /*
   * The events still to come are the ones waiting for their start: in the
   * scheduled state, or a state of the project's own placed after it and
   * before Ongoing ("Confirmed") - not the scheduled flag. Every one the
   * member may read, shown on a status page or not: this is the team's
   * own list.
   */
  test("maintenance still to come: by the states events wait for their start in, soonest first", async () => {
    await WorkspaceOpenRecords.read({
      kind: WorkspaceOpenRecordKind.UpcomingMaintenance,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    const read: JSONObject = maintenanceFind.mock.calls[0]![0] as never;
    const query: JSONObject = read["query"] as JSONObject;

    expect(read["props"]).toBe(PROPS);
    expect(query["currentScheduledMaintenanceState"]).toBeUndefined();
    expect(query["isVisibleOnStatusPage"]).toBeUndefined();
    expect(idsAskedFor(query["currentScheduledMaintenanceStateId"])).toEqual(
      WAITING_STATES.map((id: ObjectID): string => {
        return id.toString();
      }).sort(),
    );
    expect(read["sort"]).toEqual({ startsAt: SortOrder.Ascending });
  });

  test("maintenance in progress: by the states events are in progress in, latest first", async () => {
    await WorkspaceOpenRecords.read({
      kind: WorkspaceOpenRecordKind.OngoingMaintenance,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    const read: JSONObject = maintenanceFind.mock.calls[0]![0] as never;

    expect(
      idsAskedFor(
        (read["query"] as JSONObject)["currentScheduledMaintenanceStateId"],
      ),
    ).toEqual(
      IN_PROGRESS_STATES.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    expect(read["sort"]).toEqual({ startsAt: SortOrder.Descending });
  });

  test("a project with no open states reads nothing, and lists nothing", async () => {
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([]);

    const list: WorkspaceOpenRecordList = await WorkspaceOpenRecords.read({
      kind: WorkspaceOpenRecordKind.Incidents,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(incidentFind).not.toHaveBeenCalled();
    expect(list.records).toEqual([]);
    expect(list.isCut).toBe(false);
  });

  test("one more record than the list holds: the list is cut, and says so", async () => {
    incidentFind.mockResolvedValue(
      Array.from({ length: 11 }, (_v: unknown, index: number): Incident => {
        return incident({ number: 100 - index, title: `Outage ${index}` });
      }),
    );

    const list: WorkspaceOpenRecordList = await WorkspaceOpenRecords.read({
      kind: WorkspaceOpenRecordKind.Incidents,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(list.records).toHaveLength(10);
    expect(list.isCut).toBe(true);
    expect(list.records[0]!.number).toBe("INC-100");
    expect(list.listLink).toBe(`${DASHBOARD}/${PROJECT_ID.toString()}/incidents`);
  });

  test("a smaller limit, for the Home: that many, and cut after them", async () => {
    alertFind.mockResolvedValue([
      alert({ number: 3, title: "a" }),
      alert({ number: 2, title: "b" }),
      alert({ number: 1, title: "c" }),
    ]);

    const list: WorkspaceOpenRecordList = await WorkspaceOpenRecords.read({
      kind: WorkspaceOpenRecordKind.Alerts,
      projectId: PROJECT_ID,
      props: PROPS,
      limit: 2,
    });

    expect((alertFind.mock.calls[0]![0] as JSONObject)["limit"]).toBe(3);
    expect(list.records.map((record: WorkspaceOpenRecord) => {
      return record.number;
    })).toEqual(["AL-3", "AL-2"]);
    expect(list.isCut).toBe(true);
  });

  test("no dashboard address: the records, without links", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockRejectedValue(new BadDataException("no host"));
    incidentFind.mockResolvedValue([
      incident({ number: 8, title: "Checkout is down" }),
    ]);

    const list: WorkspaceOpenRecordList = await WorkspaceOpenRecords.read({
      kind: WorkspaceOpenRecordKind.Incidents,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(list.records[0]!.link).toBeNull();
    expect(list.listLink).toBeNull();
  });
});

describe("what a list says", () => {
  test("open incidents: one line each, the number linked, then title, severity, state and since when", async () => {
    const checkout: Incident = incident({
      number: 12,
      title: "Checkout is down",
      severity: "Critical",
      state: "Identified",
      declaredAt: DECLARED,
    });
    const search: Incident = incident({
      number: 11,
      title: "Search is slow",
      severity: "Minor",
      state: "Acknowledged",
    });
    incidentFind.mockResolvedValue([checkout, search]);

    const answer: WorkspaceAnswer = await WorkspaceOpenRecords.getListAnswer({
      kind: WorkspaceOpenRecordKind.Incidents,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(answer.markdown).toBe(
      [
        "🚨 **Open incidents**",
        `- **[INC-12](${linkOf("incidents", checkout)})** Checkout is down · Critical · Identified · since ${at(DECLARED)}`,
        `- **[INC-11](${linkOf("incidents", search)})** Search is slow · Minor · Acknowledged`,
        "",
        `[See every incident in OneUptime](${DASHBOARD}/${PROJECT_ID.toString()}/incidents)`,
      ].join("\n"),
    );
    expect(answer.text).toBe(
      "Open incidents: INC-12 Checkout is down, INC-11 Search is slow",
    );
  });

  test("an incident that was created but never declared reads since it was created", async () => {
    const row: Incident = incident({ number: 3, title: "Disk full" });
    row.createdAt = DECLARED;
    incidentFind.mockResolvedValue([row]);

    const answer: WorkspaceAnswer = await WorkspaceOpenRecords.getListAnswer({
      kind: WorkspaceOpenRecordKind.Incidents,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(answer.markdown).toContain(`Disk full · since ${at(DECLARED)}`);
  });

  test("open alerts", async () => {
    const disk: Alert = alert({
      number: 7,
      title: "Disk 95% on web-1",
      severity: "Warning",
      state: "Created",
      createdAt: DECLARED,
    });
    alertFind.mockResolvedValue([disk]);

    const answer: WorkspaceAnswer = await WorkspaceOpenRecords.getListAnswer({
      kind: WorkspaceOpenRecordKind.Alerts,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(answer.markdown).toBe(
      [
        "⚠️ **Open alerts**",
        `- **[AL-7](${linkOf("alerts", disk)})** Disk 95% on web-1 · Warning · Created · since ${at(DECLARED)}`,
        "",
        `[See every alert in OneUptime](${DASHBOARD}/${PROJECT_ID.toString()}/alerts)`,
      ].join("\n"),
    );
    expect(answer.text).toBe("Open alerts: AL-7 Disk 95% on web-1");
  });

  test("maintenance still to come: when it starts and ends", async () => {
    const upgrade: ScheduledMaintenance = maintenance({
      number: 3,
      title: "Database upgrade",
      state: "Scheduled",
      startsAt: STARTS,
      endsAt: ENDS,
    });
    maintenanceFind.mockResolvedValue([upgrade]);

    const answer: WorkspaceAnswer = await WorkspaceOpenRecords.getListAnswer({
      kind: WorkspaceOpenRecordKind.UpcomingMaintenance,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(answer.markdown).toBe(
      [
        "🛠️ **Scheduled maintenance coming up**",
        `- **[SM-3](${linkOf("scheduled-maintenance-events", upgrade)})** Database upgrade · from ${at(STARTS)} to ${at(ENDS)}`,
        "",
        `[See every scheduled maintenance event in OneUptime](${DASHBOARD}/${PROJECT_ID.toString()}/scheduled-maintenance-events)`,
      ].join("\n"),
    );
    expect(answer.text).toBe(
      "Scheduled maintenance coming up: SM-3 Database upgrade",
    );
  });

  test("maintenance in progress: its state, and until when", async () => {
    const upgrade: ScheduledMaintenance = maintenance({
      number: 3,
      title: "Database upgrade",
      state: "Verifying",
      startsAt: STARTS,
      endsAt: ENDS,
    });
    maintenanceFind.mockResolvedValue([upgrade]);

    const answer: WorkspaceAnswer = await WorkspaceOpenRecords.getListAnswer({
      kind: WorkspaceOpenRecordKind.OngoingMaintenance,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(answer.markdown.split("\n")[1]).toBe(
      `- **[SM-3](${linkOf("scheduled-maintenance-events", upgrade)})** Database upgrade · Verifying · until ${at(ENDS)}`,
    );
  });

  test.each([
    [WorkspaceOpenRecordKind.Incidents, "✅ **No open incidents.**", "No open incidents."],
    [WorkspaceOpenRecordKind.Alerts, "✅ **No open alerts.**", "No open alerts."],
    [
      WorkspaceOpenRecordKind.UpcomingMaintenance,
      "🛠️ **No scheduled maintenance coming up.**",
      "No scheduled maintenance coming up.",
    ],
    [
      WorkspaceOpenRecordKind.OngoingMaintenance,
      "🔧 **No maintenance in progress.**",
      "No maintenance in progress.",
    ],
  ])(
    "%s, none open: one short line",
    async (kind: WorkspaceOpenRecordKind, markdown: string, text: string) => {
      const answer: WorkspaceAnswer = await WorkspaceOpenRecords.getListAnswer({
        kind: kind,
        projectId: PROJECT_ID,
        props: PROPS,
      });

      expect(answer).toEqual({ markdown: markdown, text: text });
    },
  );

  test("a list cut short says how many it shows, and links to the rest", () => {
    const records: Array<WorkspaceOpenRecord> = Array.from(
      { length: 10 },
      (_v: unknown, index: number): WorkspaceOpenRecord => {
        return {
          number: `INC-${index + 1}`,
          title: `Outage ${index + 1}`,
          link: null,
          severity: null,
          state: null,
          startsAt: null,
          endsAt: null,
        };
      },
    );

    const answer: WorkspaceAnswer = WorkspaceOpenRecords.toAnswer({
      kind: WorkspaceOpenRecordKind.Incidents,
      records: records,
      isCut: true,
      listLink: `${DASHBOARD}/p/incidents`,
    });

    expect(answer.markdown.split("\n").slice(-2)).toEqual([
      "",
      `These are the first 10. [See every incident in OneUptime](${DASHBOARD}/p/incidents)`,
    ]);
    expect(answer.text).toBe(
      "Open incidents: INC-1 Outage 1, INC-2 Outage 2, INC-3 Outage 3 and more",
    );
  });

  test("the notification names three records, then how many more", () => {
    const answer: WorkspaceAnswer = WorkspaceOpenRecords.toAnswer({
      kind: WorkspaceOpenRecordKind.Alerts,
      records: ["a", "b", "c", "d", "e"].map(
        (title: string, index: number): WorkspaceOpenRecord => {
          return {
            number: `AL-${index}`,
            title: title,
            link: null,
            severity: null,
            state: null,
            startsAt: null,
            endsAt: null,
          };
        },
      ),
      isCut: false,
      listLink: null,
    });

    expect(answer.text).toBe("Open alerts: AL-0 a, AL-1 b, AL-2 c and 2 more");
    // No dashboard address: no links, and no footer.
    expect(answer.markdown).not.toContain("](");
    expect(answer.markdown.split("\n")).toHaveLength(6);
  });

  test("a title on many lines reads on one, a long one is cut, an empty one is named", () => {
    const line: (title: string) => string = (title: string): string => {
      return WorkspaceOpenRecords.getLine(WorkspaceOpenRecordKind.Incidents, {
        number: "INC-1",
        title: title,
        link: null,
        severity: null,
        state: null,
        startsAt: null,
        endsAt: null,
      }).toString();
    };

    expect(line("Checkout\n\n   is   down")).toBe("**INC-1** Checkout is down");
    expect(line("")).toBe("**INC-1** Untitled");

    const long: string = line("x".repeat(500));
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThan(140);
  });

  test("a title is text: Markdown in it is shown, not read", () => {
    const line: string = WorkspaceOpenRecords.getLine(
      WorkspaceOpenRecordKind.Incidents,
      {
        number: "INC-1",
        title: "**bold** [click](https://evil.example) <!channel>",
        link: null,
        severity: "*Sev 1*",
        state: null,
        startsAt: null,
        endsAt: null,
      },
    ).toString();

    expect(line).not.toContain("[click](");
    expect(line).not.toContain("**bold**");
    expect(line).not.toContain(" *Sev 1*");
  });

  test("ten records with long titles stay a short message", () => {
    const answer: WorkspaceAnswer = WorkspaceOpenRecords.toAnswer({
      kind: WorkspaceOpenRecordKind.Incidents,
      records: Array.from(
        { length: 10 },
        (_v: unknown, index: number): WorkspaceOpenRecord => {
          return {
            number: `INC-${index}`,
            title: "y".repeat(400),
            link: `${DASHBOARD}/${PROJECT_ID.toString()}/incidents/${ObjectID.generate().toString()}`,
            severity: "Critical",
            state: "Investigating",
            startsAt: DECLARED,
            endsAt: null,
          };
        },
      ),
      isCut: true,
      listLink: `${DASHBOARD}/${PROJECT_ID.toString()}/incidents`,
    });

    expect(answer.markdown.length).toBeLessThan(4000);
  });
});

describe("a member who may not read a kind of record is told so", () => {
  test.each([
    [
      WorkspaceOpenRecordKind.Incidents,
      new NotAuthorizedException("no read"),
      "You do not have permission to see the incidents in this project. Ask a project admin for access to them.",
    ],
    [
      WorkspaceOpenRecordKind.Alerts,
      new PaymentRequiredException("plan"),
      "You do not have permission to see the alerts in this project. Ask a project admin for access to them.",
    ],
    [
      WorkspaceOpenRecordKind.UpcomingMaintenance,
      new NotAuthorizedException("no read"),
      "You do not have permission to see the scheduled maintenance events in this project. Ask a project admin for access to them.",
    ],
  ])(
    "%s",
    async (kind: WorkspaceOpenRecordKind, refusal: Error, sentence: string) => {
      incidentFind.mockRejectedValue(refusal);
      alertFind.mockRejectedValue(refusal);
      maintenanceFind.mockRejectedValue(refusal);

      const answer: WorkspaceAnswer = await WorkspaceOpenRecords.getListAnswer({
        kind: kind,
        projectId: PROJECT_ID,
        props: PROPS,
      });

      expect(answer).toEqual({ markdown: sentence, text: sentence });
    },
  );

  test("any other failure is not taken for a refusal", async () => {
    incidentFind.mockRejectedValue(new Error("connection reset"));

    await expect(
      WorkspaceOpenRecords.getListAnswer({
        kind: WorkspaceOpenRecordKind.Incidents,
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    ).rejects.toThrow("connection reset");
  });
});
