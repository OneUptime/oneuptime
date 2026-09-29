import {
  CreateAlertNoteTool,
  CreateIncidentNoteTool,
} from "../../../../Server/Utils/AI/Toolbox/NoteWriteTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../../Server/Services/AlertService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * create_incident_note / create_alert_note file PRIVATE internal notes — the
 * team-only counterpart of post_incident_status_update. These tests lock in
 * the mutation contract: the acting user comes from ctx.props (never a tool
 * argument), the write is tenant-pinned from ctx, the result carries the
 * created note id with a deep-link citation, and the required-argument
 * failures are loud (BadDataException), not silent.
 */

const USER_ID: ObjectID = ObjectID.generate();

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true, userId: USER_ID },
};

const INCIDENT_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();
const NOTE_ID: ObjectID = ObjectID.generate();

function buildIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.incidentNumber = 42;
  incident.title = "Checkout down";
  return incident;
}

function buildAlert(): Alert {
  const alert: Alert = new Alert();
  alert._id = ALERT_ID.toString();
  alert.alertNumber = 9;
  alert.title = "High CPU on api-1";
  return alert;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("create_incident_note", () => {
  test("creates the private note as ctx's user and cites the incident", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);

    const createdNote: IncidentInternalNote = new IncidentInternalNote();
    createdNote._id = NOTE_ID.toString();
    const createSpy: jest.SpyInstance = jest
      .spyOn(IncidentInternalNoteService, "create")
      .mockResolvedValue(createdNote as never);

    const result: ToolExecutionResult = await CreateIncidentNoteTool.execute(
      {
        incidentId: INCIDENT_ID.toString(),
        note: "DB failover completed; watching error rates.",
      },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(NOTE_ID.toString());
    expect(result.dataForLlm).toContain("#42");
    expect(result.dataForLlm).toContain("team members only");
    expect(result.citationLabel).toBe("Internal note on incident #42");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: INCIDENT_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    // The write runs under the user's props with tenancy pinned from ctx.
    const callArgs: JSONObject = createSpy.mock.calls[0]?.[0] as JSONObject;
    const data: IncidentInternalNote = callArgs["data"] as IncidentInternalNote;
    expect(data.note).toBe("DB failover completed; watching error rates.");
    expect(data.projectId).toBe(ctx.projectId);
    expect(String(data.incidentId)).toBe(INCIDENT_ID.toString());
    expect(data.createdByUserId).toBe(USER_ID);
    expect(callArgs["props"]).toBe(ctx.props);
  });

  test("the acting user comes from ctx.props even when args smuggle a userId", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);

    const createSpy: jest.SpyInstance = jest
      .spyOn(IncidentInternalNoteService, "create")
      .mockResolvedValue(new IncidentInternalNote() as never);

    await CreateIncidentNoteTool.execute(
      {
        incidentId: INCIDENT_ID.toString(),
        note: "note text",
        userId: ObjectID.generate().toString(),
        createdByUserId: ObjectID.generate().toString(),
      },
      ctx,
    );

    const callArgs: JSONObject = createSpy.mock.calls[0]?.[0] as JSONObject;
    const data: IncidentInternalNote = callArgs["data"] as IncidentInternalNote;
    expect(data.createdByUserId).toBe(USER_ID);
  });

  test("missing incidentId is a loud BadData error", async () => {
    await expect(
      CreateIncidentNoteTool.execute({ note: "orphan note" }, ctx),
    ).rejects.toThrow("incidentId is required");
  });

  test("missing note is a loud BadData error", async () => {
    await expect(
      CreateIncidentNoteTool.execute(
        { incidentId: INCIDENT_ID.toString() },
        ctx,
      ),
    ).rejects.toThrow("note is required");
  });

  test("refuses to write when the incident is not visible to the user", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);
    const createSpy: jest.SpyInstance = jest.spyOn(
      IncidentInternalNoteService,
      "create",
    );

    await expect(
      CreateIncidentNoteTool.execute(
        { incidentId: INCIDENT_ID.toString(), note: "note text" },
        ctx,
      ),
    ).rejects.toThrow("Incident not found");
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("refuses to write without an authenticated user in context", async () => {
    const anonymousCtx: ToolContext = {
      projectId: ctx.projectId,
      props: { isRoot: true },
    };

    await expect(
      CreateIncidentNoteTool.execute(
        { incidentId: INCIDENT_ID.toString(), note: "note text" },
        anonymousCtx,
      ),
    ).rejects.toThrow("No authenticated user");
  });

  test("buildActionTitle names the incident from validated args", () => {
    expect(
      CreateIncidentNoteTool.buildActionTitle!({
        incidentId: INCIDENT_ID.toString(),
      }),
    ).toBe(`Add private internal note to incident ${INCIDENT_ID.toString()}`);
  });

  test("is a mutation whose permissions derive from the note model's create ACL", () => {
    expect(CreateIncidentNoteTool.isMutation).toBe(true);
    expect(CreateIncidentNoteTool.requiredPermissions.length).toBeGreaterThan(
      0,
    );
  });
});

describe("create_alert_note", () => {
  test("creates the private note as ctx's user and cites the alert", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(buildAlert() as never);

    const createdNote: AlertInternalNote = new AlertInternalNote();
    createdNote._id = NOTE_ID.toString();
    const createSpy: jest.SpyInstance = jest
      .spyOn(AlertInternalNoteService, "create")
      .mockResolvedValue(createdNote as never);

    const result: ToolExecutionResult = await CreateAlertNoteTool.execute(
      {
        alertId: ALERT_ID.toString(),
        note: "CPU normalized after rollout pause.",
      },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(NOTE_ID.toString());
    expect(result.dataForLlm).toContain("#9");
    expect(result.dataForLlm).toContain("team members only");
    expect(result.citationLabel).toBe("Internal note on alert #9");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: ALERT_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    const callArgs: JSONObject = createSpy.mock.calls[0]?.[0] as JSONObject;
    const data: AlertInternalNote = callArgs["data"] as AlertInternalNote;
    expect(data.note).toBe("CPU normalized after rollout pause.");
    expect(data.projectId).toBe(ctx.projectId);
    expect(String(data.alertId)).toBe(ALERT_ID.toString());
    expect(data.createdByUserId).toBe(USER_ID);
    expect(callArgs["props"]).toBe(ctx.props);
  });

  test("missing alertId is a loud BadData error", async () => {
    await expect(
      CreateAlertNoteTool.execute({ note: "orphan note" }, ctx),
    ).rejects.toThrow("alertId is required");
  });

  test("missing note is a loud BadData error", async () => {
    await expect(
      CreateAlertNoteTool.execute({ alertId: ALERT_ID.toString() }, ctx),
    ).rejects.toThrow("note is required");
  });

  test("refuses to write when the alert is not visible to the user", async () => {
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(null as never);
    const createSpy: jest.SpyInstance = jest.spyOn(
      AlertInternalNoteService,
      "create",
    );

    await expect(
      CreateAlertNoteTool.execute(
        { alertId: ALERT_ID.toString(), note: "note text" },
        ctx,
      ),
    ).rejects.toThrow("Alert not found");
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("buildActionTitle names the alert from validated args", () => {
    expect(
      CreateAlertNoteTool.buildActionTitle!({
        alertId: ALERT_ID.toString(),
      }),
    ).toBe(`Add private internal note to alert ${ALERT_ID.toString()}`);
  });

  test("is a mutation whose permissions derive from the note model's create ACL", () => {
    expect(CreateAlertNoteTool.isMutation).toBe(true);
    expect(CreateAlertNoteTool.requiredPermissions.length).toBeGreaterThan(0);
  });
});
