import AlertService from "../../../../../Server/Services/AlertService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import CodeTaskContextBuilder from "../../../../../Server/Utils/AI/CodeTask/CodeTaskContextBuilder";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import Service from "../../../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import {
  CODE_TASK_LIMITS,
  CodeTaskContextItem,
  CodeTaskContextType,
} from "../../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * What a person adds to a request becomes what the AI is given. A OneUptime
 * record is read when the request is sent, under the asker's OWN
 * permissions and pinned to the request's project, so a request can only
 * carry what its author may see - a record of another project, or one their
 * labels keep from them, is refused as missing - and what is kept is
 * redacted the way the AI toolbox redacts what it hands a model, and capped.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const RECORD_ID: string = "6a0e2d4c-1b3f-4e5a-8c7d-9f0e1a2b3c4d";
const SERVICE_ID: string = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"),
  tenantId: PROJECT_ID,
};

afterEach(() => {
  jest.restoreAllMocks();
});

async function buildOne(
  input: Record<string, unknown>,
): Promise<CodeTaskContextItem> {
  const items: Array<CodeTaskContextItem> = await CodeTaskContextBuilder.build({
    inputs: [input as never],
    projectId: PROJECT_ID,
    props: PROPS,
  });

  expect(items).toHaveLength(1);
  return items[0]!;
}

async function refusal(input: Record<string, unknown>): Promise<string> {
  try {
    await buildOne(input);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as BadDataException).message;
  }

  throw new Error("Expected the context to be refused.");
}

function named<T extends { name?: string | undefined }>(
  type: { new (): T },
  name: string,
): T {
  const value: T = new type();
  value.name = name;
  return value;
}

describe("what a person writes is kept as written", () => {
  test("a note is its text, labelled by its first words on one line", async () => {
    const item: CodeTaskContextItem = await buildOne({
      type: CodeTaskContextType.Note,
      text: "The checkout API returns 500\nwhen the cart is empty and the user is signed out of the store",
    });

    expect(item.type).toBe(CodeTaskContextType.Note);
    expect(item.text).toBe(
      "The checkout API returns 500\nwhen the cart is empty and the user is signed out of the store",
    );
    expect(item.label).toBe(
      "The checkout API returns 500 when the cart is empty and the…",
    );
    expect(item.snapshot).toBeUndefined();
  });

  test("a link is labelled by its name, or by its host and path", async () => {
    expect(
      await buildOne({
        type: CodeTaskContextType.Link,
        url: "https://docs.example.com/retries",
        title: "Retry spec",
      }),
    ).toEqual({
      type: CodeTaskContextType.Link,
      label: "Retry spec",
      url: "https://docs.example.com/retries",
    });

    expect(
      (
        await buildOne({
          type: CodeTaskContextType.Link,
          url: "https://docs.example.com/retries",
        })
      ).label,
    ).toBe("docs.example.com/retries");
  });

  test("a file is its path in the repository", async () => {
    expect(
      await buildOne({ type: CodeTaskContextType.File, path: "src/a.ts" }),
    ).toEqual({
      type: CodeTaskContextType.File,
      label: "src/a.ts",
      path: "src/a.ts",
    });
  });
});

describe("a OneUptime record is read as the person who asked, in this project", () => {
  test("an incident: its state, severity, monitors, description and root cause", async () => {
    const incident: Incident = new Incident();
    incident._id = RECORD_ID;
    incident.title = "Checkout is down";
    incident.incidentNumber = 42;
    incident.description = "Customers see a 500 on /checkout.";
    incident.rootCause = "A null cart.";
    incident.createdAt = new Date("2026-10-19T08:00:00.000Z");
    incident.currentIncidentState = named(IncidentState, "Investigating");
    incident.incidentSeverity = named(IncidentSeverity, "Critical");
    incident.monitors = [named(Monitor, "Checkout API"), named(Monitor, "Cart")];

    const find: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident);

    const item: CodeTaskContextItem = await buildOne({
      type: CodeTaskContextType.Incident,
      id: RECORD_ID,
    });

    const call: { query: JSONObject; props: unknown } = find.mock
      .calls[0]![0] as unknown as { query: JSONObject; props: unknown };

    expect(call.query["_id"]).toBe(RECORD_ID);
    expect((call.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    // The asker's own permissions - never root.
    expect(call.props).toBe(PROPS);

    expect(item).toEqual({
      type: CodeTaskContextType.Incident,
      recordId: RECORD_ID,
      label: "Incident #42: Checkout is down",
      snapshot: [
        "Incident #42: Checkout is down",
        [
          "State: Investigating",
          "Severity: Critical",
          "Declared: 2026-10-19T08:00:00.000Z",
          "Monitors: Checkout API, Cart",
        ].join("\n"),
        "Description:\nCustomers see a 500 on /checkout.",
        "Root cause:\nA null cart.",
      ].join("\n\n"),
    });
  });

  test("a project's own numbering names the record", async () => {
    const incident: Incident = new Incident();
    incident.title = "Checkout is down";
    incident.incidentNumber = 42;
    incident.incidentNumberWithPrefix = "INC-42";

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);

    expect(
      (await buildOne({ type: CodeTaskContextType.Incident, id: RECORD_ID }))
        .label,
    ).toBe("Incident INC-42: Checkout is down");
  });

  test("an alert, with its monitor", async () => {
    const alert: Alert = new Alert();
    alert.title = "High latency";
    alert.alertNumber = 7;
    alert.currentAlertState = named(AlertState, "Created");
    alert.alertSeverity = named(AlertSeverity, "Warning");
    alert.monitor = named(Monitor, "API latency");

    const find: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alert);

    const item: CodeTaskContextItem = await buildOne({
      type: CodeTaskContextType.Alert,
      id: RECORD_ID,
    });

    expect((find.mock.calls[0]![0] as { props: unknown }).props).toBe(PROPS);
    expect(item.label).toBe("Alert #7: High latency");
    expect(item.snapshot).toContain("Monitor: API latency");
    expect(item.snapshot).toContain("Severity: Warning");
  });

  test("an exception: its type, message and stack trace, and its service when the person may see it", async () => {
    const exception: TelemetryException = new TelemetryException();
    exception.exceptionType = "TypeError";
    exception.message = "Cannot read properties of undefined (reading 'id')";
    exception.stackTrace =
      "TypeError: Cannot read properties of undefined\n    at checkout (src/checkout.ts:12:5)";
    exception.occuranceCount = 31;
    exception.environment = "production";
    exception.primaryEntityId = new ObjectID(SERVICE_ID);

    jest
      .spyOn(TelemetryExceptionService, "findOneBy")
      .mockResolvedValue(exception);
    const findService: SpyInstance<typeof ServiceService.findOneBy> =
      jest
        .spyOn(ServiceService, "findOneBy")
        .mockResolvedValue(named(Service, "checkout-api"));

    const item: CodeTaskContextItem = await buildOne({
      type: CodeTaskContextType.Exception,
      id: RECORD_ID,
    });

    expect((findService.mock.calls[0]![0] as { props: unknown }).props).toBe(
      PROPS,
    );
    expect(item.label).toBe(
      "TypeError: Cannot read properties of undefined (reading 'id')",
    );
    expect(item.snapshot).toContain("Service: checkout-api");
    expect(item.snapshot).toContain("Occurrences: 31");
    expect(item.snapshot).toContain("at checkout (src/checkout.ts:12:5)");
  });

  test("an exception whose service the person may not see is read without it", async () => {
    const exception: TelemetryException = new TelemetryException();
    exception.exceptionType = "Error";
    exception.message = "boom";
    exception.primaryEntityId = new ObjectID(SERVICE_ID);

    jest
      .spyOn(TelemetryExceptionService, "findOneBy")
      .mockResolvedValue(exception);
    jest
      .spyOn(ServiceService, "findOneBy")
      .mockRejectedValue(new Error("not allowed"));

    const item: CodeTaskContextItem = await buildOne({
      type: CodeTaskContextType.Exception,
      id: RECORD_ID,
    });

    expect(item.snapshot).not.toContain("Service:");
  });

  test("a monitor: its type, status and description", async () => {
    const monitor: Monitor = new Monitor();
    monitor.name = "Checkout API";
    monitor.monitorType = MonitorType.API;
    monitor.description = "Hits /health every minute.";
    monitor.currentMonitorStatus = named(MonitorStatus, "Offline");

    jest.spyOn(MonitorService, "findOneBy").mockResolvedValue(monitor);

    const item: CodeTaskContextItem = await buildOne({
      type: CodeTaskContextType.Monitor,
      id: RECORD_ID,
    });

    expect(item.label).toBe("Checkout API");
    expect(item.snapshot).toContain("Type: API");
    expect(item.snapshot).toContain("Status: Offline");
  });

  test.each([
    [CodeTaskContextType.Incident, "incident"],
    [CodeTaskContextType.Alert, "alert"],
    [CodeTaskContextType.Exception, "exception"],
    [CodeTaskContextType.Monitor, "monitor"],
  ])(
    "a %s the person cannot see - another project's, or one their labels keep from them - is refused as missing",
    async (type: CodeTaskContextType, word: string) => {
      jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
      jest.spyOn(AlertService, "findOneBy").mockResolvedValue(null);
      jest.spyOn(TelemetryExceptionService, "findOneBy").mockResolvedValue(null);
      jest.spyOn(MonitorService, "findOneBy").mockResolvedValue(null);

      expect(await refusal({ type, id: RECORD_ID })).toBe(
        `That ${word} was not found in this project, or you cannot see it.`,
      );
    },
  );
});

describe("what the AI is given is redacted and capped", () => {
  test("secrets and personal data in a record are taken out", async () => {
    const incident: Incident = new Incident();
    incident.title = "Leaked key";
    incident.incidentNumber = 1;
    incident.description = [
      "Contact jane.doe@example.com about it.",
      "The key was AKIAIOSFODNN7EXAMPLE and the server 10.1.2.3.",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      "password=hunter2-very-secret",
    ].join("\n");

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);

    const snapshot: string =
      (await buildOne({ type: CodeTaskContextType.Incident, id: RECORD_ID }))
        .snapshot || "";

    expect(snapshot).not.toContain("jane.doe@example.com");
    expect(snapshot).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(snapshot).not.toContain("10.1.2.3");
    expect(snapshot).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(snapshot).not.toContain("hunter2-very-secret");
    expect(snapshot).toContain("[redacted-email]");
  });

  test("an embedded image is left out, not handed to the model", async () => {
    const incident: Incident = new Incident();
    incident.title = "Screenshot";
    incident.incidentNumber = 1;
    incident.description = `See ![shot](data:image/png;base64,${"iVBORw0KGgo".repeat(400)})`;

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);

    const snapshot: string =
      (await buildOne({ type: CodeTaskContextType.Incident, id: RECORD_ID }))
        .snapshot || "";

    expect(snapshot).not.toContain("iVBORw0KGgoiVBORw0KGgo");
    expect(snapshot).toContain("image omitted");
  });

  test("a record's snapshot is capped", async () => {
    const incident: Incident = new Incident();
    incident.title = "Long";
    incident.incidentNumber = 1;
    incident.description = "word ".repeat(CODE_TASK_LIMITS.maxSnapshotLength);

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);

    const snapshot: string =
      (await buildOne({ type: CodeTaskContextType.Incident, id: RECORD_ID }))
        .snapshot || "";

    expect(snapshot.length).toBeLessThanOrEqual(
      CODE_TASK_LIMITS.maxSnapshotLength + "\n… [truncated]".length,
    );
    expect(snapshot.endsWith("… [truncated]")).toBe(true);
  });
});

describe("telemetry is read through the AI toolbox, as the person who asked", () => {
  test("a trace: its span tree, from get_trace in this project", async () => {
    const execute: SpyInstance<typeof AIToolbox.executeTool> = jest
      .spyOn(AIToolbox, "executeTool")
      .mockResolvedValue({
        success: true,
        textForLlm: "",
        result: {
          dataForLlm: "GET /checkout 1200ms\n  SELECT carts 1100ms",
          rowCount: 2,
          citationLabel: "trace",
          redactionCount: 0,
          isTruncated: false,
        },
      });

    const item: CodeTaskContextItem = await buildOne({
      type: CodeTaskContextType.Trace,
      traceId: TRACE_ID,
    });

    const call: Parameters<typeof AIToolbox.executeTool>[0] =
      execute.mock.calls[0]![0];

    expect(call.name).toBe("get_trace");
    expect(call.args).toEqual({ traceId: TRACE_ID });
    expect(call.ctx.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.ctx.props).toBe(PROPS);
    expect(item).toEqual({
      type: CodeTaskContextType.Trace,
      label: "Trace 4bf92f35…",
      traceId: TRACE_ID,
      snapshot: `Trace ${TRACE_ID} (span tree):\nGET /checkout 1200ms\n  SELECT carts 1100ms`,
    });
  });

  test("a trace with no spans in this project is refused with why", async () => {
    jest.spyOn(AIToolbox, "executeTool").mockResolvedValue({
      success: true,
      textForLlm: "",
      result: {
        dataForLlm: "",
        rowCount: 0,
        citationLabel: "trace",
        redactionCount: 0,
        isTruncated: false,
      },
    });

    expect(
      await refusal({ type: CodeTaskContextType.Trace, traceId: TRACE_ID }),
    ).toContain("No spans were found for that trace ID in this project.");
  });

  test("a trace the person may not read is refused with the toolbox's reason", async () => {
    jest.spyOn(AIToolbox, "executeTool").mockResolvedValue({
      success: false,
      textForLlm: "",
      errorMessage: "Permission denied for tool: get_trace",
    });

    expect(
      await refusal({ type: CodeTaskContextType.Trace, traceId: TRACE_ID }),
    ).toBe("Permission denied for tool: get_trace");
  });

  test("logs: the latest matching lines of the window asked for, in the service asked for", async () => {
    const execute: SpyInstance<typeof AIToolbox.executeTool> = jest
      .spyOn(AIToolbox, "executeTool")
      .mockResolvedValue({
        success: true,
        textForLlm: "",
        result: {
          dataForLlm: "12:00 ERROR timeout calling payments",
          rowCount: 1,
          citationLabel: "logs",
          redactionCount: 0,
          isTruncated: false,
        },
      });

    const before: number = Date.now();
    const item: CodeTaskContextItem = await buildOne({
      type: CodeTaskContextType.Logs,
      search: "timeout",
      hours: 168,
      serviceId: SERVICE_ID,
    });

    const call: Parameters<typeof AIToolbox.executeTool>[0] =
      execute.mock.calls[0]![0];
    const start: number = Date.parse(call.args["startTime"] as string);
    const end: number = Date.parse(call.args["endTime"] as string);

    expect(call.name).toBe("search_logs");
    expect(call.ctx.props).toBe(PROPS);
    expect(call.args["bodySearchText"]).toBe("timeout");
    expect(call.args["serviceId"]).toBe(SERVICE_ID);
    expect(end - start).toBe(168 * 60 * 60 * 1000);
    expect(end).toBeGreaterThanOrEqual(before - 1000);
    expect(item.label).toBe('Logs matching "timeout"');
    expect(item.hours).toBe(168);
    expect(item.serviceId).toBe(SERVICE_ID);
    expect(item.snapshot).toContain("12:00 ERROR timeout calling payments");
  });

  test("a search with no lines says so, rather than nothing", async () => {
    jest.spyOn(AIToolbox, "executeTool").mockResolvedValue({
      success: true,
      textForLlm: "",
      result: {
        dataForLlm: "",
        rowCount: 0,
        citationLabel: "logs",
        redactionCount: 0,
        isTruncated: false,
      },
    });

    const item: CodeTaskContextItem = await buildOne({
      type: CodeTaskContextType.Logs,
      search: "nothing-matches",
    });

    expect(item.snapshot).toContain("(no matching log lines)");
    expect(item.serviceId).toBeUndefined();
  });
});
