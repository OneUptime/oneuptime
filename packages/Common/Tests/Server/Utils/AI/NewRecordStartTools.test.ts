/*
 * Toolbox/Index first: the toolbox sits in an import cycle (tool -> service
 * -> ... -> AIToolbox), and production always enters through Index.
 */
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import { CreateAlertTool } from "../../../../Server/Utils/AI/Toolbox/AlertWriteTools";
import { CreateIncidentTool } from "../../../../Server/Utils/AI/Toolbox/IncidentWriteTools";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import { AIToolRefusal } from "../../../../Types/AI/AIChatTypes";
import {
  AI_ACTION_CARD_LINES,
  AIActionCardWords,
  aiActionSentence,
  describeAIActionCardWords,
  isKnownAIActionCardWords,
} from "../../../../Types/AI/AIActionWords";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { actionLineText } from "../../../Helpers/AIActionText";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

// A stand-in for a service's read or write, with the calls it was given.
type CallRecorder = Mock<(...args: Array<unknown>) => unknown>;

/*
 * A STARTING STATE FOR THE RECORDS ASK AI CREATES (#5315's follow-up).
 *
 * "We had a twenty-minute checkout outage this morning, it's fixed - record
 * it." create_incident and create_alert made every record where every new
 * one starts, so its on-call policies paged people for a problem that was
 * over. They take an initialState now:
 *
 *   - "acknowledged" or "resolved" starts the record in the project's
 *     acknowledged or resolved state - the ones Acknowledge and Resolve
 *     move a record into, whatever the project calls them - so it pages
 *     nobody (Common/Utils/StartingStage decides the rest);
 *   - the approval card says so before anyone allows it, and the card the
 *     record leaves says where it started;
 *   - it takes the permission to change the record's state as well as the
 *     permission to create one, at the toolbox's gate: a person who may
 *     file incidents but not close them cannot file one nobody is paged
 *     for;
 *   - a value that is neither is refused before anything is written, never
 *     quietly a new record that pages.
 *
 * And create_incident's card says the severity the incident takes, as
 * create_alert's says its alert's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const RECORD_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SEVERITY_ID: string = "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1";
const OTHER_SEVERITY_ID: string = "f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2";
const CREATED_STATE_ID: string = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const ACKNOWLEDGED_STATE_ID: string = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
const RESOLVED_STATE_ID: string = "a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3";

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A project member, signed in, in the project: who asks.
function member(
  permissions: Array<Permission> = [Permission.ProjectMember],
  blocks?: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions,
      projectId: PROJECT_ID,
      ...(blocks ? { blocks } : {}),
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function contextFor(
  props: DatabaseCommonInteractionProps = member(),
): ToolContext {
  return { projectId: PROJECT_ID, props };
}

/*
 * The project's states, as the state services read them - its acknowledged
 * and resolved states named its own way.
 */
function states<T extends IncidentState | AlertState>(
  make: () => T,
  options?: { withoutResolved?: boolean },
): Array<T> {
  const rows: Array<[string, string, number, string]> = [
    [CREATED_STATE_ID, "Identified", 1, "isCreatedState"],
    [ACKNOWLEDGED_STATE_ID, "Investigating", 2, "isAcknowledgedState"],
    ...(options?.withoutResolved
      ? []
      : ([[RESOLVED_STATE_ID, "Closed", 3, "isResolvedState"]] as Array<
          [string, string, number, string]
        >)),
  ];

  return rows.map(
    ([id, name, order, flag]: [string, string, number, string]): T => {
      const state: T = make();
      state._id = id;
      state.name = name;
      state.order = order;
      (state as unknown as Record<string, boolean>)["isCreatedState"] =
        flag === "isCreatedState";
      (state as unknown as Record<string, boolean>)["isAcknowledgedState"] =
        flag === "isAcknowledgedState";
      (state as unknown as Record<string, boolean>)["isResolvedState"] =
        flag === "isResolvedState";
      return state;
    },
  );
}

/*
 * The two tools, each with the services it reads and writes: what is
 * created, the states read, and the severities read.
 */
interface Twin {
  noun: "incident" | "alert";
  tool: ObservabilityTool;
  stateChange: Permission;
  createOnly: Permission;
  severityName: string;
  stub: (options?: {
    withoutResolved?: boolean;
    severityNames?: Array<string>;
  }) => {
    create: CallRecorder;
    readStates: CallRecorder;
    readSeverities: CallRecorder;
  };
  createdStateId: (data: unknown) => string | undefined;
}

function severityRows<T extends IncidentSeverity | AlertSeverity>(
  make: () => T,
  names: Array<string>,
): Array<T> {
  return names.map((name: string, index: number): T => {
    const severity: T = make();
    severity._id = index === 0 ? SEVERITY_ID : OTHER_SEVERITY_ID;
    severity.name = name;
    severity.order = index + 1;
    return severity;
  });
}

const INCIDENT: Twin = {
  noun: "incident",
  tool: CreateIncidentTool,
  stateChange: Permission.CreateIncidentStateTimeline,
  createOnly: Permission.CreateProjectIncident,
  severityName: "SEV1",
  stub: (options?: {
    withoutResolved?: boolean;
    severityNames?: Array<string>;
  }) => {
    const readSeverities: CallRecorder = jest.fn((): unknown => {
      return Promise.resolve(
        severityRows(
          (): IncidentSeverity => {
            return new IncidentSeverity();
          },
          options?.severityNames || ["SEV1", "SEV2"],
        ),
      );
    });
    jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockImplementation(readSeverities as never);

    const readStates: CallRecorder = jest.fn((): unknown => {
      return Promise.resolve(
        states((): IncidentState => {
          return new IncidentState();
        }, options),
      );
    });
    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockImplementation(readStates as never);

    const create: CallRecorder = jest.fn((createBy: unknown): unknown => {
      const created: Incident = (createBy as { data: Incident }).data;
      created._id = RECORD_ID;
      created.incidentNumber = 42;
      created.incidentNumberWithPrefix = "INC-42";
      return Promise.resolve(created);
    });
    jest.spyOn(IncidentService, "create").mockImplementation(create as never);

    return { create, readStates, readSeverities };
  },
  createdStateId: (data: unknown): string | undefined => {
    return (data as Incident).currentIncidentStateId?.toString();
  },
};

const ALERT: Twin = {
  noun: "alert",
  tool: CreateAlertTool,
  stateChange: Permission.CreateAlertStateTimeline,
  createOnly: Permission.CreateAlert,
  severityName: "High",
  stub: (options?: {
    withoutResolved?: boolean;
    severityNames?: Array<string>;
  }) => {
    const readSeverities: CallRecorder = jest.fn((): unknown => {
      return Promise.resolve(
        severityRows(
          (): AlertSeverity => {
            return new AlertSeverity();
          },
          options?.severityNames || ["High", "Low"],
        ),
      );
    });
    jest
      .spyOn(AlertSeverityService, "findBy")
      .mockImplementation(readSeverities as never);

    const readStates: CallRecorder = jest.fn((): unknown => {
      return Promise.resolve(
        states((): AlertState => {
          return new AlertState();
        }, options),
      );
    });
    jest
      .spyOn(AlertStateService, "getAllAlertStates")
      .mockImplementation(readStates as never);

    const create: CallRecorder = jest.fn((createBy: unknown): unknown => {
      const created: Alert = (createBy as { data: Alert }).data;
      created._id = RECORD_ID;
      created.alertNumber = 12;
      created.alertNumberWithPrefix = "ALT-12";
      return Promise.resolve(created);
    });
    jest.spyOn(AlertService, "create").mockImplementation(create as never);

    return { create, readStates, readSeverities };
  },
  createdStateId: (data: unknown): string | undefined => {
    return (data as Alert).currentAlertStateId?.toString();
  },
};

const TWINS: Array<[string, Twin]> = [
  ["create_incident", INCIDENT],
  ["create_alert", ALERT],
];

function createdData(create: CallRecorder): unknown {
  return (create.mock.calls[0]![0] as { data: unknown }).data;
}

function cardWords(result: ToolExecutionResult): AIActionCardWords {
  return (result.widget?.data as { words: AIActionCardWords }).words;
}

describe.each(TWINS)(
  "%s: where the record starts",
  (_name: string, twin: Twin) => {
    test("left out: where every new one starts - no state is picked, and none is read", async () => {
      const stubs: ReturnType<Twin["stub"]> = twin.stub();

      const result: ToolExecutionResult = await twin.tool.execute(
        { title: "Checkout down" },
        contextFor(),
      );

      expect(stubs.create).toHaveBeenCalledTimes(1);
      expect(twin.createdStateId(createdData(stubs.create))).toBeUndefined();
      expect(stubs.readStates).not.toHaveBeenCalled();
      expect(result.dataForLlm).not.toContain("paged anyone");
      expect(describeAIActionCardWords(cardWords(result)).line).toBe(
        `Severity: ${twin.severityName}`,
      );
    });

    test.each([
      ["acknowledged", ACKNOWLEDGED_STATE_ID, "Started acknowledged"],
      ["Resolved", RESOLVED_STATE_ID, "Started resolved"],
    ])(
      "%s: the project's own state of that kind, which pages nobody",
      async (asked: string, stateId: string, cardLine: string) => {
        const stubs: ReturnType<Twin["stub"]> = twin.stub();

        const result: ToolExecutionResult = await twin.tool.execute(
          { title: "Checkout down", initialState: asked },
          contextFor(),
        );

        expect(stubs.create).toHaveBeenCalledTimes(1);
        expect(twin.createdStateId(createdData(stubs.create))).toBe(stateId);

        // Which state that is, is the project's to say: read as OneUptime.
        expect(stubs.readStates).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          props: { isRoot: true },
        });

        // The model is told it paged nobody, and why.
        expect(result.dataForLlm).toContain("no on-call policy paged anyone");

        // The card it leaves says where it started, after its severity.
        expect(isKnownAIActionCardWords(cardWords(result))).toBe(true);
        expect(describeAIActionCardWords(cardWords(result)).line).toBe(
          `Severity: ${twin.severityName} · ${cardLine}`,
        );
        expect(cardWords(result).line?.[1]).toEqual(
          aiActionSentence(
            stateId === ACKNOWLEDGED_STATE_ID
              ? AI_ACTION_CARD_LINES.startedAcknowledged
              : AI_ACTION_CARD_LINES.startedResolved,
          ),
        );
      },
    );

    test("a value that is neither is refused before anything is read or written", async () => {
      const stubs: ReturnType<Twin["stub"]> = twin.stub();

      await expect(
        twin.tool.execute(
          { title: "Checkout down", initialState: "investigating" },
          contextFor(),
        ),
      ).rejects.toThrow(
        `initialState must be "acknowledged" or "resolved". Leave it out for a new ${twin.noun} that pages its on-call policies.`,
      );

      expect(stubs.create).not.toHaveBeenCalled();
      expect(stubs.readStates).not.toHaveBeenCalled();
      expect(stubs.readSeverities).not.toHaveBeenCalled();
    });

    test("a project without the state asked for is told so, and nothing is created", async () => {
      const stubs: ReturnType<Twin["stub"]> = twin.stub({
        withoutResolved: true,
      });

      await expect(
        twin.tool.execute(
          { title: "Checkout down", initialState: "resolved" },
          contextFor(),
        ),
      ).rejects.toThrow(`This project has no resolved ${twin.noun} state.`);

      expect(stubs.create).not.toHaveBeenCalled();
    });

    test("the approval card says where it starts, and the start the person approves is written the one way", async () => {
      twin.stub();

      const prepared: PreparedMutation = await twin.tool.prepareMutation!(
        { title: "Checkout down", initialState: " RESOLVED " },
        contextFor(),
      );

      expect(prepared.arguments["initialState"]).toBe("resolved");
      expect(actionLineText(prepared.description)).toBe(
        `Severity: ${twin.severityName}. Starts resolved, so it pages nobody.`,
      );
      // The line says the severity and the start: the argument line need not.
      expect(prepared.describedArguments).toEqual([
        "severityName",
        "initialState",
      ]);
    });

    test("a start that is neither says nothing of a start on the card: running it refuses", async () => {
      twin.stub();

      const prepared: PreparedMutation = await twin.tool.prepareMutation!(
        { title: "Checkout down", initialState: "later" },
        contextFor(),
      );

      expect(prepared.arguments["initialState"]).toBe("later");
      expect(actionLineText(prepared.description)).toBe(
        `Severity: ${twin.severityName}.`,
      );
      expect(prepared.describedArguments).toEqual(["severityName"]);
    });

    test("the model is offered the start, with when to use it and when never to", () => {
      const schema: JSONObject = (
        twin.tool.inputSchema["properties"] as Record<string, JSONObject>
      )["initialState"]!;

      expect(schema["enum"]).toEqual(["acknowledged", "resolved"]);
      expect(String(schema["description"])).toContain(
        `Leave it out for a new ${twin.noun}`,
      );
      expect(String(schema["description"])).toContain(
        "Never use it to keep people from being paged about a live problem.",
      );
    });
  },
);

describe.each(TWINS)(
  "%s: who may start it later",
  (name: string, twin: Twin) => {
    test("without a start, the permission to create one is all it takes, as before", () => {
      expect(twin.tool.getRequiredPermissionGroups!({ title: "x" })).toEqual([
        twin.tool.requiredPermissions,
      ]);
    });

    test("with a start - or a value that is neither - it takes the permission to change its state too", () => {
      for (const initialState of ["acknowledged", "resolved", "later"]) {
        const groups: Array<Array<Permission>> = twin.tool
          .getRequiredPermissionGroups!({ title: "x", initialState });

        expect(groups).toHaveLength(2);
        expect(groups[0]).toEqual(twin.tool.requiredPermissions);
        expect(groups[1]).toContain(twin.stateChange);
        expect(groups[1]).not.toContain(twin.createOnly);
      }
    });

    test("a member who may create one but not change its state is refused a start, at the gate, before anything is read", async () => {
      const stubs: ReturnType<Twin["stub"]> = twin.stub();

      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name,
        args: { title: "Checkout down", initialState: "resolved" },
        ctx: contextFor(member([twin.createOnly])),
      });

      expect(outcome.success).toBe(false);
      expect(outcome.refusal).toBe(AIToolRefusal.Permission);
      expect(outcome.textForLlm).toContain(
        "It needs one of these permissions:",
      );
      expect(outcome.textForLlm).toContain(
        twin.noun === "incident"
          ? "Create Incident State Timeline"
          : "Create Alert State Timeline",
      );
      expect(stubs.create).not.toHaveBeenCalled();
      expect(stubs.readStates).not.toHaveBeenCalled();
    });

    test("the same member creates one that starts where every new one does", async () => {
      const stubs: ReturnType<Twin["stub"]> = twin.stub();

      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name,
        args: { title: "Checkout down" },
        ctx: contextFor(member([twin.createOnly])),
      });

      expect(outcome.refusal).toBeUndefined();
      expect(outcome.success).toBe(true);
      expect(stubs.create).toHaveBeenCalledTimes(1);
    });

    test("a member who may do both starts it resolved, as themselves", async () => {
      const stubs: ReturnType<Twin["stub"]> = twin.stub();
      const props: DatabaseCommonInteractionProps = member([
        twin.createOnly,
        twin.stateChange,
      ]);

      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name,
        args: { title: "Checkout down", initialState: "resolved" },
        ctx: contextFor(props),
      });

      expect(outcome.success).toBe(true);
      expect(stubs.create).toHaveBeenCalledTimes(1);
      expect((stubs.create.mock.calls[0]![0] as { props: unknown }).props).toBe(
        props,
      );
      expect(twin.createdStateId(createdData(stubs.create))).toBe(
        RESOLVED_STATE_ID,
      );
    });

    test("a team's block on changing its state refuses a start, and says it is the team's", async () => {
      const stubs: ReturnType<Twin["stub"]> = twin.stub();

      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name,
        args: { title: "Checkout down", initialState: "acknowledged" },
        ctx: contextFor(
          member([twin.createOnly, twin.stateChange], [twin.stateChange]),
        ),
      });

      expect(outcome.success).toBe(false);
      expect(outcome.refusal).toBe(AIToolRefusal.TeamBlock);
      expect(outcome.textForLlm).toContain("a team they belong to blocks");
      expect(stubs.create).not.toHaveBeenCalled();
    });
  },
);

describe("create_incident's card says the severity it takes, as create_alert's does", () => {
  test("the severity the call names, by the name the project gave it, first on the line", async () => {
    INCIDENT.stub({ severityNames: ["SEV1", "Major"] });

    const prepared: PreparedMutation =
      await CreateIncidentTool.prepareMutation!(
        { title: "Checkout down", severityName: "major" },
        contextFor(),
      );

    expect(prepared.arguments["severityName"]).toBe("Major");
    expect(actionLineText(prepared.description)).toBe("Severity: Major.");
  });

  test("none named, or one the project lacks: the project's first, written out for approval", async () => {
    INCIDENT.stub({ severityNames: ["SEV1", "SEV2"] });

    for (const severityName of [undefined, "P0"]) {
      const prepared: PreparedMutation =
        await CreateIncidentTool.prepareMutation!(
          {
            title: "Checkout down",
            ...(severityName ? { severityName } : {}),
          },
          contextFor(),
        );

      expect(prepared.arguments["severityName"]).toBe("SEV1");
      expect(actionLineText(prepared.description)).toBe("Severity: SEV1.");
    }
  });

  test("the severities are read as the person, in the request's project, never an archived one", async () => {
    const stubs: ReturnType<Twin["stub"]> = INCIDENT.stub();
    const ctx: ToolContext = contextFor();

    await CreateIncidentTool.prepareMutation!({ title: "x" }, ctx);

    const read: { query: JSONObject; props: unknown } = stubs.readSeverities
      .mock.calls[0]![0] as { query: JSONObject; props: unknown };
    expect(read.props).toBe(ctx.props);
    expect(read.query).toEqual({ projectId: PROJECT_ID, isArchived: false });
  });

  test("severities the person may not read, or none at all: no severity line, and the action is still asked about", async () => {
    jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockRejectedValue(new Error("not allowed") as never);

    const refused: PreparedMutation = await CreateIncidentTool.prepareMutation!(
      { title: "x" },
      contextFor(),
    );
    expect(refused.arguments["severityName"]).toBeUndefined();
    expect(refused.description).toEqual([]);
    expect(refused.describedArguments).toEqual([]);

    jest.restoreAllMocks();
    INCIDENT.stub({ severityNames: [] });

    const none: PreparedMutation = await CreateIncidentTool.prepareMutation!(
      { title: "x" },
      contextFor(),
    );
    expect(none.description).toEqual([]);
  });

  test("running it takes the severity named, or the first, and tells the model when the one named does not exist", async () => {
    const stubs: ReturnType<Twin["stub"]> = INCIDENT.stub({
      severityNames: ["SEV1", "SEV2"],
    });

    const result: ToolExecutionResult = await CreateIncidentTool.execute(
      { title: "Checkout down", severityName: "P0" },
      contextFor(),
    );

    expect(
      (createdData(stubs.create) as Incident).incidentSeverityId?.toString(),
    ).toBe(SEVERITY_ID);
    expect(result.dataForLlm).toContain(
      'No incident severity of this project is named "P0", so it took the first, SEV1. The project\'s incident severities: SEV1, SEV2.',
    );

    // The card names it by the number the person knows it by.
    expect((result.widget?.data as { heading: string }).heading).toBe(
      "INC-42 · Checkout down",
    );
  });

  test("a project with no incident severity is told how to add one", async () => {
    const stubs: ReturnType<Twin["stub"]> = INCIDENT.stub({
      severityNames: [],
    });

    await expect(
      CreateIncidentTool.execute({ title: "Checkout down" }, contextFor()),
    ).rejects.toThrow(
      "No incident severities are configured for this project. Add one in Incidents > Settings > Incident Severity first.",
    );
    expect(stubs.create).not.toHaveBeenCalled();
  });
});
