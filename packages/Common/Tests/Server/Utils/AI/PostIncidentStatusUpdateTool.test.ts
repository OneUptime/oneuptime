import { PostIncidentStatusUpdateTool } from "../../../../Server/Utils/AI/Toolbox/AIActionTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * post_incident_status_update posts a customer-facing public note. When the
 * copilot does not say whether to notify subscribers, the note follows the
 * incident: an incident declared without notifying status page subscribers
 * stays quiet, every other incident notifies. An explicit choice always wins.
 */

const USER_ID: ObjectID = ObjectID.generate();

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true, userId: USER_ID },
};

const INCIDENT_ID: ObjectID = ObjectID.generate();
const NOTE_TEXT: string = "We have identified the cause and are rolling back.";

function buildIncident(
  notifiedOnCreate?: boolean | null | undefined,
): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.incidentNumber = 42;
  incident.title = "Checkout down";
  if (notifiedOnCreate !== undefined) {
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
      notifiedOnCreate as boolean;
  }
  return incident;
}

interface ToolRun {
  result: ToolExecutionResult;
  data: IncidentPublicNote;
  createArgs: JSONObject;
  findSpy: jest.SpyInstance;
  createSpy: jest.SpyInstance;
}

async function runTool(
  incident: Incident | null,
  extraArgs: JSONObject = {},
  toolCtx: ToolContext = ctx,
): Promise<ToolRun> {
  const findSpy: jest.SpyInstance = jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(incident as never);

  const createSpy: jest.SpyInstance = jest
    .spyOn(IncidentPublicNoteService, "create")
    .mockResolvedValue(new IncidentPublicNote() as never);

  const result: ToolExecutionResult =
    await PostIncidentStatusUpdateTool.execute(
      {
        incidentId: INCIDENT_ID.toString(),
        note: NOTE_TEXT,
        ...extraArgs,
      },
      toolCtx,
    );

  const createArgs: JSONObject = createSpy.mock.calls[0]?.[0] as JSONObject;

  return {
    result,
    data: createArgs["data"] as IncidentPublicNote,
    createArgs,
    findSpy,
    createSpy,
  };
}

function widgetSubheading(result: ToolExecutionResult): unknown {
  return (result.widget?.data as unknown as JSONObject | undefined)?.[
    "subheading"
  ];
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("post_incident_status_update - default subscriber notification", () => {
  test("stays quiet when notifySubscribers is omitted and the incident was declared without notifying subscribers", async () => {
    const run: ToolRun = await runTool(buildIncident(false));

    expect(run.createSpy).toHaveBeenCalledTimes(1);
    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(run.result.dataForLlm).not.toContain("notified subscribers");
    expect(run.result.dataForLlm).toContain(
      "Posted a public status update on incident #42.",
    );
    expect(run.result.dataForLlm).toContain("notifySubscribers=false");
    expect(widgetSubheading(run.result)).toBe("Subscribers not notified");
  });

  test("notifies when notifySubscribers is omitted and the incident notified subscribers when declared", async () => {
    const run: ToolRun = await runTool(buildIncident(true));

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      true,
    );
    expect(run.result.dataForLlm).toContain(
      "Posted a public status update on incident #42 and notified subscribers.",
    );
    expect(run.result.dataForLlm).toContain("notifySubscribers=true");
    expect(widgetSubheading(run.result)).toBe("Subscribers notified");
  });

  test("notifies when notifySubscribers is omitted and the incident flag was never set", async () => {
    const run: ToolRun = await runTool(buildIncident(undefined));

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      true,
    );
    expect(run.result.dataForLlm).toContain("and notified subscribers");
    expect(run.result.dataForLlm).toContain("notifySubscribers=true");
  });

  test("notifies when notifySubscribers is omitted and the incident flag is null", async () => {
    const run: ToolRun = await runTool(buildIncident(null));

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      true,
    );
    expect(run.result.dataForLlm).toContain("and notified subscribers");
  });

  test("treats a null notifySubscribers argument as omitted and inherits the quiet incident default", async () => {
    const run: ToolRun = await runTool(buildIncident(false), {
      notifySubscribers: null,
    });

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(run.result.dataForLlm).not.toContain("notified subscribers");
  });

  test("ignores an unparseable notifySubscribers value and falls back to the quiet incident default", async () => {
    const run: ToolRun = await runTool(buildIncident(false), {
      notifySubscribers: "yes",
    });

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(run.result.dataForLlm).toContain("notifySubscribers=false");
  });

  test("ignores an unparseable notifySubscribers value and falls back to the notifying incident default", async () => {
    const run: ToolRun = await runTool(buildIncident(true), {
      notifySubscribers: 0,
    });

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      true,
    );
    expect(run.result.dataForLlm).toContain("notifySubscribers=true");
  });
});

describe("post_incident_status_update - explicit notifySubscribers wins", () => {
  test("explicit true notifies even on an incident declared without notifying subscribers", async () => {
    const run: ToolRun = await runTool(buildIncident(false), {
      notifySubscribers: true,
    });

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      true,
    );
    expect(run.result.dataForLlm).toContain("and notified subscribers");
    expect(run.result.dataForLlm).toContain("notifySubscribers=true");
    expect(widgetSubheading(run.result)).toBe("Subscribers notified");
  });

  test("explicit false stays quiet even on an incident that notified subscribers", async () => {
    const run: ToolRun = await runTool(buildIncident(true), {
      notifySubscribers: false,
    });

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(run.result.dataForLlm).not.toContain("notified subscribers");
    expect(run.result.dataForLlm).toContain("notifySubscribers=false");
    expect(widgetSubheading(run.result)).toBe("Subscribers not notified");
  });

  test("explicit false stays quiet on an incident whose flag was never set", async () => {
    const run: ToolRun = await runTool(buildIncident(undefined), {
      notifySubscribers: false,
    });

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
  });

  test('string "false" is parsed as an explicit false on a notifying incident', async () => {
    const run: ToolRun = await runTool(buildIncident(true), {
      notifySubscribers: "false",
    });

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(run.result.dataForLlm).not.toContain("notified subscribers");
  });

  test('string "true" is parsed as an explicit true on a quiet incident', async () => {
    const run: ToolRun = await runTool(buildIncident(false), {
      notifySubscribers: "true",
    });

    expect(run.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      true,
    );
    expect(run.result.dataForLlm).toContain("and notified subscribers");
  });
});

describe("post_incident_status_update - incident lookup", () => {
  test("selects the incident's notify-on-create flag and reads it under ctx.props", async () => {
    const run: ToolRun = await runTool(buildIncident(false));

    expect(run.findSpy).toHaveBeenCalledTimes(1);
    const findArgs: JSONObject = run.findSpy.mock.calls[0]?.[0] as JSONObject;
    expect(String(findArgs["id"])).toBe(INCIDENT_ID.toString());
    expect(findArgs["select"]).toEqual({
      _id: true,
      incidentNumber: true,
      title: true,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    });
    expect(findArgs["props"]).toBe(ctx.props);
  });

  test("still looks the incident up when notifySubscribers is explicit", async () => {
    const run: ToolRun = await runTool(buildIncident(true), {
      notifySubscribers: false,
    });

    expect(run.findSpy).toHaveBeenCalledTimes(1);
    const findArgs: JSONObject = run.findSpy.mock.calls[0]?.[0] as JSONObject;
    expect(
      (findArgs["select"] as JSONObject)[
        "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"
      ],
    ).toBe(true);
  });

  test("a missing incident is a BadData error and no note is created", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);
    const createSpy: jest.SpyInstance = jest.spyOn(
      IncidentPublicNoteService,
      "create",
    );

    const execution: Promise<ToolExecutionResult> =
      PostIncidentStatusUpdateTool.execute(
        { incidentId: INCIDENT_ID.toString(), note: NOTE_TEXT },
        ctx,
      );

    await expect(execution).rejects.toThrow(BadDataException);
    await expect(execution).rejects.toThrow("Incident not found");
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a missing incident is a BadData error even when notifySubscribers is explicit", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);
    const createSpy: jest.SpyInstance = jest.spyOn(
      IncidentPublicNoteService,
      "create",
    );

    await expect(
      PostIncidentStatusUpdateTool.execute(
        {
          incidentId: INCIDENT_ID.toString(),
          note: NOTE_TEXT,
          notifySubscribers: true,
        },
        ctx,
      ),
    ).rejects.toThrow(BadDataException);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("post_incident_status_update - argument validation", () => {
  test("missing incidentId is a BadData error before any lookup or write", async () => {
    const findSpy: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "findOneById",
    );
    const createSpy: jest.SpyInstance = jest.spyOn(
      IncidentPublicNoteService,
      "create",
    );

    const execution: Promise<ToolExecutionResult> =
      PostIncidentStatusUpdateTool.execute({ note: NOTE_TEXT }, ctx);

    await expect(execution).rejects.toThrow(BadDataException);
    await expect(execution).rejects.toThrow("incidentId is required");
    expect(findSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("missing note is a BadData error before any lookup or write", async () => {
    const findSpy: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "findOneById",
    );
    const createSpy: jest.SpyInstance = jest.spyOn(
      IncidentPublicNoteService,
      "create",
    );

    const execution: Promise<ToolExecutionResult> =
      PostIncidentStatusUpdateTool.execute(
        { incidentId: INCIDENT_ID.toString(), notifySubscribers: false },
        ctx,
      );

    await expect(execution).rejects.toThrow(BadDataException);
    await expect(execution).rejects.toThrow("note is required");
    expect(findSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a whitespace-only note is treated as missing", async () => {
    const createSpy: jest.SpyInstance = jest.spyOn(
      IncidentPublicNoteService,
      "create",
    );

    await expect(
      PostIncidentStatusUpdateTool.execute(
        { incidentId: INCIDENT_ID.toString(), note: "   " },
        ctx,
      ),
    ).rejects.toThrow("note is required");
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("missing authenticated user is a BadData error before any lookup or write", async () => {
    const findSpy: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "findOneById",
    );
    const createSpy: jest.SpyInstance = jest.spyOn(
      IncidentPublicNoteService,
      "create",
    );
    const anonymousCtx: ToolContext = {
      projectId: ctx.projectId,
      props: { isRoot: true },
    };

    const execution: Promise<ToolExecutionResult> =
      PostIncidentStatusUpdateTool.execute(
        { incidentId: INCIDENT_ID.toString(), note: NOTE_TEXT },
        anonymousCtx,
      );

    await expect(execution).rejects.toThrow(BadDataException);
    await expect(execution).rejects.toThrow("No authenticated user");
    expect(findSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("post_incident_status_update - created note", () => {
  test("pins the note to the incident, the ctx project and the acting user", async () => {
    const before: number = Date.now();
    const run: ToolRun = await runTool(buildIncident(false));
    const after: number = Date.now();

    expect(run.data).toBeInstanceOf(IncidentPublicNote);
    expect(String(run.data.incidentId)).toBe(INCIDENT_ID.toString());
    expect(run.data.projectId).toBe(ctx.projectId);
    expect(run.data.note).toBe(NOTE_TEXT);
    expect(run.data.createdByUserId).toBe(USER_ID);
    expect(run.data.postedAt).toBeInstanceOf(Date);
    expect(run.data.postedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(run.data.postedAt!.getTime()).toBeLessThanOrEqual(after);
    expect(run.createArgs["props"]).toBe(ctx.props);
  });

  test("the acting user comes from ctx.props even when args smuggle a userId", async () => {
    const run: ToolRun = await runTool(buildIncident(true), {
      userId: ObjectID.generate().toString(),
      createdByUserId: ObjectID.generate().toString(),
    });

    expect(run.data.createdByUserId).toBe(USER_ID);
  });

  test("the project comes from ctx even when args smuggle a projectId", async () => {
    const run: ToolRun = await runTool(buildIncident(true), {
      projectId: ObjectID.generate().toString(),
    });

    expect(run.data.projectId).toBe(ctx.projectId);
  });

  test("returns a single-row result that cites the incident", async () => {
    const run: ToolRun = await runTool(buildIncident(false));

    expect(run.result.rowCount).toBe(1);
    expect(run.result.isTruncated).toBe(false);
    expect(run.result.dataForLlm).toContain("incidentNumber=42");
    expect(run.result.citationLabel).toBe("Status update on incident #42");
    expect(run.result.citationTarget).toEqual({
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: INCIDENT_ID.toString() },
    });
    expect(run.result.widget).toBeDefined();
  });
});

describe("post_incident_status_update - tool metadata", () => {
  test("the notifySubscribers schema explains the incident-based default", () => {
    const properties: JSONObject = PostIncidentStatusUpdateTool.inputSchema[
      "properties"
    ] as JSONObject;
    const notifySubscribers: JSONObject = properties[
      "notifySubscribers"
    ] as JSONObject;

    expect(notifySubscribers["type"]).toBe("boolean");
    const description: string = notifySubscribers["description"] as string;
    expect(description).toContain("Defaults to true");
    expect(description).toContain(
      "false when subscribers were not notified when the incident was declared",
    );
  });

  test("notifySubscribers stays optional", () => {
    expect(PostIncidentStatusUpdateTool.inputSchema["required"]).toEqual([
      "incidentId",
      "note",
    ]);
  });

  test("the tool description tells the model a quietly declared incident stays quiet", () => {
    expect(PostIncidentStatusUpdateTool.description).toContain(
      "by default, notifies subscribers",
    );
    expect(PostIncidentStatusUpdateTool.description).toContain(
      "unless subscribers were not notified when the incident was declared",
    );
    expect(PostIncidentStatusUpdateTool.description).toContain(
      "stays quiet by default",
    );
  });

  test("is a mutation whose permissions derive from the public note model's create ACL", () => {
    expect(PostIncidentStatusUpdateTool.name).toBe(
      "post_incident_status_update",
    );
    expect(PostIncidentStatusUpdateTool.isMutation).toBe(true);
    expect(
      PostIncidentStatusUpdateTool.requiredPermissions.length,
    ).toBeGreaterThan(0);
  });

  test("buildActionTitle names the incident from args", () => {
    expect(
      PostIncidentStatusUpdateTool.buildActionTitle!({
        incidentId: INCIDENT_ID.toString(),
      }),
    ).toBe(`Post public status update on incident ${INCIDENT_ID.toString()}`);
  });
});
