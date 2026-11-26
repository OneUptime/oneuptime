import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../../Models/DatabaseModels/Project";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import ProjectService from "../../../../Server/Services/ProjectService";
import IncidentDeclaredByHandStartReader, {
  IncidentDeclaredByHandStartingState,
} from "../../../../Server/Utils/Incident/IncidentDeclaredByHandStartReader";
import logger from "../../../../Server/Utils/Logger";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { INCIDENT_DECLARED_BY_HAND_KEY } from "../../../../Types/Incident/IncidentDeclaredByHandStart";
import ObjectID from "../../../../Types/ObjectID";
import { StartingStage } from "../../../../Utils/StartingStage";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";

/*
 * THE SERVER'S SIDE OF "START INCIDENTS DECLARED BY HAND ACKNOWLEDGED"
 * (#11137): reading the declare forms' flag, the project's switch, and the
 * state an incident declared by hand starts in.
 *
 *   - the flag is true or false, absent for a create no form sent; anything
 *     else is refused;
 *   - the switch is read once, as OneUptime, for that one column, and a read
 *     that fails is off - declaring never waits on or fails over it;
 *   - an incident that pages a policy starts in the created state without
 *     the switch being read; one that pages nobody starts in the project's
 *     acknowledged state while the switch is on, placed as any state an
 *     incident starts in is;
 *   - and the scan at the end pins who sends the flag: the three declare
 *     forms, and nothing else.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c1113700-0000-4000-8000-000000000001",
);

const CREATED_STATE: string = "c1113700-0000-4000-8000-0000000000a1";
const ACKNOWLEDGED_STATE: string = "c1113700-0000-4000-8000-0000000000a2";
const RESOLVED_STATE: string = "c1113700-0000-4000-8000-0000000000a3";

type FindOneById = typeof ProjectService.findOneById;

let findSpy: SpyInstance<FindOneById>;
let statesSpy: SpyInstance<typeof IncidentStateService.getAllIncidentStates>;

function projectWith(value: boolean | undefined): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  if (value !== undefined) {
    project.startIncidentsDeclaredByHandAcknowledged = value;
  }

  return project;
}

function state(data: {
  id: string;
  order: number;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}): IncidentState {
  const incidentState: IncidentState = new IncidentState();
  incidentState._id = data.id;
  incidentState.order = data.order;
  incidentState.isCreatedState = Boolean(data.isCreatedState);
  incidentState.isAcknowledgedState = Boolean(data.isAcknowledgedState);
  incidentState.isResolvedState = Boolean(data.isResolvedState);
  return incidentState;
}

const PROJECT_STATES: Array<IncidentState> = [
  state({ id: CREATED_STATE, order: 1, isCreatedState: true }),
  state({ id: ACKNOWLEDGED_STATE, order: 2, isAcknowledgedState: true }),
  state({ id: RESOLVED_STATE, order: 3, isResolvedState: true }),
];

function policy(id: string): OnCallDutyPolicy {
  const onCallDutyPolicy: OnCallDutyPolicy = new OnCallDutyPolicy();
  onCallDutyPolicy._id = id;
  return onCallDutyPolicy;
}

beforeEach(() => {
  findSpy = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(projectWith(true) as never);
  statesSpy = jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockResolvedValue(PROJECT_STATES as never);
  jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the declare forms' flag", () => {
  test("absent, or null, is a create no declare form sent", () => {
    expect(
      IncidentDeclaredByHandStartReader.readDeclaredByHand(undefined),
    ).toBe(false);
    expect(IncidentDeclaredByHandStartReader.readDeclaredByHand(null)).toBe(
      false,
    );
  });

  test("true or false is what it says", () => {
    expect(IncidentDeclaredByHandStartReader.readDeclaredByHand(true)).toBe(
      true,
    );
    expect(IncidentDeclaredByHandStartReader.readDeclaredByHand(false)).toBe(
      false,
    );
  });

  test.each([["true"], ["false"], [1], [0], [{}], [[]], [""]])(
    "%j is refused, naming the key",
    (value: unknown) => {
      expect(() => {
        IncidentDeclaredByHandStartReader.readDeclaredByHand(value);
      }).toThrow(BadDataException);
      expect(() => {
        IncidentDeclaredByHandStartReader.readDeclaredByHand(value);
      }).toThrow(`${INCIDENT_DECLARED_BY_HAND_KEY} must be true or false.`);
    },
  );
});

describe("the project's switch", () => {
  test("is read once, as OneUptime, for its one column", async () => {
    expect(await IncidentDeclaredByHandStartReader.isOn(PROJECT_ID)).toBe(true);

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy.mock.calls[0]![0]).toEqual({
      id: PROJECT_ID,
      select: { startIncidentsDeclaredByHandAcknowledged: true },
      props: { isRoot: true },
    });
  });

  test("off, unset or no project at all is off", async () => {
    findSpy.mockResolvedValueOnce(projectWith(false) as never);
    expect(await IncidentDeclaredByHandStartReader.isOn(PROJECT_ID)).toBe(
      false,
    );

    findSpy.mockResolvedValueOnce(projectWith(undefined) as never);
    expect(await IncidentDeclaredByHandStartReader.isOn(PROJECT_ID)).toBe(
      false,
    );

    findSpy.mockResolvedValueOnce(null as never);
    expect(await IncidentDeclaredByHandStartReader.isOn(PROJECT_ID)).toBe(
      false,
    );
  });

  test("a read that fails is off, and says so in the log", async () => {
    findSpy.mockRejectedValueOnce(new Error("timeout") as never);

    await expect(
      IncidentDeclaredByHandStartReader.isOn(PROJECT_ID),
    ).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("where an incident declared by hand, with no state named, starts", () => {
  test("pages nobody, with the switch on: the project's acknowledged state, placed as acknowledged", async () => {
    const start: IncidentDeclaredByHandStartingState | null =
      await IncidentDeclaredByHandStartReader.getStartingState({
        projectId: PROJECT_ID,
        onCallPolicies: undefined,
      });

    expect(start?.incidentStateId.toString()).toBe(ACKNOWLEDGED_STATE);
    expect(start?.stage).toBe(StartingStage.Acknowledged);
  });

  test("an empty list of policies pages nobody too", async () => {
    const start: IncidentDeclaredByHandStartingState | null =
      await IncidentDeclaredByHandStartReader.getStartingState({
        projectId: PROJECT_ID,
        onCallPolicies: [],
      });

    expect(start?.incidentStateId.toString()).toBe(ACKNOWLEDGED_STATE);
  });

  test("pages a policy: none here - the created state - and the switch is not read", async () => {
    const start: IncidentDeclaredByHandStartingState | null =
      await IncidentDeclaredByHandStartReader.getStartingState({
        projectId: PROJECT_ID,
        onCallPolicies: [policy("e1113700-0000-4000-8000-000000000001")],
      });

    expect(start).toBeNull();
    expect(findSpy).not.toHaveBeenCalled();
    expect(statesSpy).not.toHaveBeenCalled();
  });

  test("with the switch off: none here, and the states are not read", async () => {
    findSpy.mockResolvedValueOnce(projectWith(false) as never);

    const start: IncidentDeclaredByHandStartingState | null =
      await IncidentDeclaredByHandStartReader.getStartingState({
        projectId: PROJECT_ID,
        onCallPolicies: [],
      });

    expect(start).toBeNull();
    expect(statesSpy).not.toHaveBeenCalled();
  });

  test("in a project with no acknowledged state: none here", async () => {
    statesSpy.mockResolvedValue([
      state({ id: CREATED_STATE, order: 1, isCreatedState: true }),
      state({ id: RESOLVED_STATE, order: 2, isResolvedState: true }),
    ] as never);

    expect(
      await IncidentDeclaredByHandStartReader.getStartingState({
        projectId: PROJECT_ID,
        onCallPolicies: [],
      }),
    ).toBeNull();
  });

  test("when the states cannot be read: none here, and the declare goes on", async () => {
    statesSpy.mockRejectedValue(new Error("timeout") as never);

    await expect(
      IncidentDeclaredByHandStartReader.getStartingState({
        projectId: PROJECT_ID,
        onCallPolicies: [],
      }),
    ).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("reads the states of the project it is declared in, as OneUptime", async () => {
    await IncidentDeclaredByHandStartReader.getStartingState({
      projectId: PROJECT_ID,
      onCallPolicies: [],
    });

    for (const call of statesSpy.mock.calls) {
      expect(call[0].projectId.toString()).toBe(PROJECT_ID.toString());
      expect(call[0].props.isRoot).toBe(true);
    }
  });
});

/*
 * Who sends the flag: the three forms people declare incidents in - Declare
 * Incident in the dashboard, and the chats' one helper Slack's and Microsoft
 * Teams' forms create through. A monitor's, a rule's, a workflow's, the
 * API's, a form's, a security case's and OneUptime AI's incidents send
 * nothing, so they start in the created state as they always did.
 */
describe("who sends the flag", () => {
  const PACKAGES: string = path.resolve(__dirname, "../../../../..");
  const SERVER_ROOT: string = path.join(PACKAGES, "Common", "Server");
  const DASHBOARD_ROOT: string = path.join(
    PACKAGES,
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
  );
  const KEY_NAME: string = "INCIDENT_DECLARED_BY_HAND_KEY";
  const CHAT_HELPER: string =
    "Utils/Workspace/WorkspaceIncidentDeclaredByHand.ts";
  const CHAT_CALL: string =
    "WorkspaceIncidentDeclaredByHand.withDeclaredByHand(";

  function sourceFiles(directory: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (
          !["node_modules", "Locales", "build", "dist"].includes(entry.name)
        ) {
          files.push(...sourceFiles(full));
        }
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }

    return files;
  }

  function filesSaying(root: string, needle: string): Array<string> {
    return sourceFiles(root)
      .filter((file: string): boolean => {
        return fs.readFileSync(file, "utf8").includes(needle);
      })
      .map((file: string): string => {
        return path.relative(root, file).split(path.sep).join("/");
      })
      .sort();
  }

  test("on the server: IncidentService reads it, through this reader, and the chats' helper sends it", () => {
    expect(filesSaying(SERVER_ROOT, KEY_NAME)).toEqual([
      "Services/IncidentService.ts",
      "Utils/Incident/IncidentDeclaredByHandStartReader.ts",
      CHAT_HELPER,
    ]);
  });

  test("Slack's and Microsoft Teams' declare forms create through the helper, and nothing else does", () => {
    expect(filesSaying(SERVER_ROOT, CHAT_CALL)).toEqual([
      "Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
      "Utils/Workspace/Slack/Actions/Incident.ts",
    ]);
  });

  test("in the dashboard: Declare Incident, and nothing else", () => {
    expect(filesSaying(DASHBOARD_ROOT, KEY_NAME)).toEqual([
      "Pages/Incidents/Create.tsx",
    ]);
  });

  test("each chat form sends it with the one create it declares", () => {
    for (const file of [
      "Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
      "Utils/Workspace/Slack/Actions/Incident.ts",
    ]) {
      const source: string = fs.readFileSync(
        path.join(SERVER_ROOT, file),
        "utf8",
      );
      const sent: number = source.indexOf(CHAT_CALL);
      const create: number = source.lastIndexOf(
        "IncidentService.create({",
        sent,
      );

      expect(source.split(CHAT_CALL)).toHaveLength(2);
      // Right in the create's own arguments.
      expect(create).toBeGreaterThan(-1);
      expect(source.slice(create, sent)).toContain("miscDataProps:");
    }
  });
});
