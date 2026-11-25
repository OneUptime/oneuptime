import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Project from "../../../../Models/DatabaseModels/Project";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import WorkspaceIncidentDeclaredByHand, {
  WORKSPACE_DECLARED_BY_HAND_TEXT,
} from "../../../../Server/Utils/Workspace/WorkspaceIncidentDeclaredByHand";
import { INCIDENT_ALERT_IDS_TO_LINK_KEY } from "../../../../Types/Incident/IncidentAlertLink";
import { INCIDENT_DECLARED_BY_HAND_KEY } from "../../../../Types/Incident/IncidentDeclaredByHandStart";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Slack's New Incident form and Microsoft Teams' Create New Incident card
 * declare incidents by hand, as Declare Incident does (#11137,
 * WorkspaceIncidentDeclaredByHand):
 *
 *   - they create with the declare forms' flag, alongside whatever they
 *     send already (the alert to link, from an alert's own channel);
 *   - while the project starts such incidents acknowledged, the on-call
 *     policies say that leaving them empty does that - and say nothing
 *     otherwise;
 *   - the confirmation says the incident was acknowledged as it was
 *     declared only when it did start acknowledged, read from the incident
 *     as created, and never guesses or fails over it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c1113700-0000-4000-8000-0000000000b1",
);
const CREATED_STATE: string = "c1113700-0000-4000-8000-0000000000c1";
const ACKNOWLEDGED_STATE: string = "c1113700-0000-4000-8000-0000000000c2";
const RESOLVED_STATE: string = "c1113700-0000-4000-8000-0000000000c3";

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

function createdIn(stateId: string | undefined): Incident {
  const incident: Incident = new Incident();

  if (stateId) {
    incident.currentIncidentStateId = new ObjectID(stateId);
  }

  return incident;
}

beforeEach(() => {
  jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockResolvedValue([
      state({ id: CREATED_STATE, order: 1, isCreatedState: true }),
      state({ id: ACKNOWLEDGED_STATE, order: 2, isAcknowledgedState: true }),
      state({ id: RESOLVED_STATE, order: 3, isResolvedState: true }),
    ] as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the create", () => {
  test("says the incident is declared by hand", () => {
    expect(WorkspaceIncidentDeclaredByHand.withDeclaredByHand()).toEqual({
      [INCIDENT_DECLARED_BY_HAND_KEY]: true,
    });
    expect(
      WorkspaceIncidentDeclaredByHand.withDeclaredByHand(undefined),
    ).toEqual({ [INCIDENT_DECLARED_BY_HAND_KEY]: true });
  });

  test("keeps what the form sends already - the alert it is declared from", () => {
    const alertLink: JSONObject = {
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [
        "a1113700-0000-4000-8000-000000000001",
      ],
    };

    expect(
      WorkspaceIncidentDeclaredByHand.withDeclaredByHand(alertLink),
    ).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [
        "a1113700-0000-4000-8000-000000000001",
      ],
      [INCIDENT_DECLARED_BY_HAND_KEY]: true,
    });
    // And never changes what it was handed.
    expect(alertLink).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [
        "a1113700-0000-4000-8000-000000000001",
      ],
    });
  });
});

describe("the hint under the on-call policies", () => {
  test("says what leaving them empty does while the switch is on", () => {
    expect(WorkspaceIncidentDeclaredByHand.getOnCallPoliciesHint(true)).toBe(
      "Leave empty and the incident starts acknowledged, so no one is paged.",
    );
  });

  test("is not there while it is off", () => {
    expect(
      WorkspaceIncidentDeclaredByHand.getOnCallPoliciesHint(false),
    ).toBeUndefined();
  });

  test("fits under a Slack select: a hint holds 2000 characters", () => {
    expect(
      WORKSPACE_DECLARED_BY_HAND_TEXT.onCallPoliciesHint.length,
    ).toBeLessThan(2000);
  });
});

describe("whether the form reads the switch", () => {
  test("as the project says, as OneUptime", async () => {
    const project: Project = new Project();
    project.startIncidentsDeclaredByHandAcknowledged = true;
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project as never);

    expect(await WorkspaceIncidentDeclaredByHand.readIsOn(PROJECT_ID)).toBe(
      true,
    );
  });

  test("off when the project cannot be read: the form opens all the same", async () => {
    jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("timeout") as never);

    await expect(
      WorkspaceIncidentDeclaredByHand.readIsOn(PROJECT_ID),
    ).resolves.toBe(false);
  });
});

describe("the confirmation's line", () => {
  test("says it was acknowledged as it was declared, when it started acknowledged", async () => {
    const line: MarkdownText | null =
      await WorkspaceIncidentDeclaredByHand.getConfirmationLine({
        projectId: PROJECT_ID,
        created: createdIn(ACKNOWLEDGED_STATE),
      });

    expect(line?.toString()).toBe(
      "Acknowledged as it was declared, so no one was paged.",
    );
  });

  test("is not there for one that started in the created state", async () => {
    expect(
      await WorkspaceIncidentDeclaredByHand.getConfirmationLine({
        projectId: PROJECT_ID,
        created: createdIn(CREATED_STATE),
      }),
    ).toBeNull();
  });

  test("is not there when the incident came back with no state", async () => {
    expect(
      await WorkspaceIncidentDeclaredByHand.getConfirmationLine({
        projectId: PROJECT_ID,
        created: createdIn(undefined),
      }),
    ).toBeNull();
  });

  test("never guesses, nor fails the confirmation, when the states cannot be read", async () => {
    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockRejectedValue(new Error("timeout") as never);

    await expect(
      WorkspaceIncidentDeclaredByHand.getConfirmationLine({
        projectId: PROJECT_ID,
        created: createdIn(ACKNOWLEDGED_STATE),
      }),
    ).resolves.toBeNull();
  });

  test("reads the states of the project the incident was declared in", async () => {
    const spy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      IncidentStateService,
      "getAllIncidentStates",
    );

    await WorkspaceIncidentDeclaredByHand.getConfirmationLine({
      projectId: PROJECT_ID,
      created: createdIn(ACKNOWLEDGED_STATE),
    });

    expect(
      (spy.mock.calls[0]![0] as { projectId: ObjectID }).projectId.toString(),
    ).toBe(PROJECT_ID.toString());
  });
});
