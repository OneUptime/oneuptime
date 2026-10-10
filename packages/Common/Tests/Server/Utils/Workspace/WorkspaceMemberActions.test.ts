import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventStanding,
  WorkspaceEventStateOption,
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";

/*
 * WorkspaceMemberActions makes the change a Slack or Microsoft Teams button
 * asks for as the member who pressed it, as the same write the dashboard
 * makes: a state timeline row, an on-call policy execution log. These tests
 * pin, for every kind of record, what is read first (the record, as the
 * member, in their project), what is written (the row, its columns, the
 * member's own props) and what is refused before anything is written. The
 * services' reads and creates are stubbed; what a create then checks is the
 * create's own (WorkspaceMemberActionsPostgres.test.ts runs it for real).
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

// The member's own props, as WorkspaceActionAuthorization builds them.
const memberProps: DatabaseCommonInteractionProps = {
  userId: userId,
  tenantId: projectId,
};

interface StateRow {
  id: ObjectID;
  name: string;
}

// A project's incident or alert states, top of the list first.
interface IncidentLikeStates<T> {
  all: Array<T>;
  created: T;
  acknowledged: T;
  investigating: T;
  resolved: T;
}

function incidentLikeStates<T extends IncidentState | AlertState>(
  makeState: () => T,
): IncidentLikeStates<T> {
  const build: (data: {
    name: string;
    order: number;
    isCreatedState?: boolean;
    isAcknowledgedState?: boolean;
    isResolvedState?: boolean;
  }) => T = (data: {
    name: string;
    order: number;
    isCreatedState?: boolean;
    isAcknowledgedState?: boolean;
    isResolvedState?: boolean;
  }): T => {
    const state: T = makeState();
    state.id = ObjectID.generate();
    state.projectId = projectId;
    state.name = data.name;
    state.order = data.order;
    state.isCreatedState = Boolean(data.isCreatedState);
    state.isAcknowledgedState = Boolean(data.isAcknowledgedState);
    state.isResolvedState = Boolean(data.isResolvedState);
    return state;
  };

  const created: T = build({ name: "Created", order: 1, isCreatedState: true });
  const acknowledged: T = build({
    name: "Acknowledged",
    order: 2,
    isAcknowledgedState: true,
  });
  // A state of the project's own between Acknowledged and Resolved.
  const investigating: T = build({ name: "Investigating", order: 3 });
  const resolved: T = build({
    name: "Resolved",
    order: 4,
    isResolvedState: true,
  });

  return {
    all: [created, acknowledged, investigating, resolved],
    created: created,
    acknowledged: acknowledged,
    investigating: investigating,
    resolved: resolved,
  };
}

// A project's scheduled maintenance states, in their order.
interface MaintenanceStates {
  scheduled: ScheduledMaintenanceState;
  ongoing: ScheduledMaintenanceState;
  ended: ScheduledMaintenanceState;
  completed: ScheduledMaintenanceState;
  // getAllScheduledMaintenanceStates, stubbed: how the moves read them.
  readSpy: AnySpy;
}

function maintenanceStates(): MaintenanceStates {
  const build: (
    name: string,
    order: number,
    flag:
      | "isScheduledState"
      | "isOngoingState"
      | "isEndedState"
      | "isResolvedState",
  ) => ScheduledMaintenanceState = (
    name: string,
    order: number,
    flag:
      | "isScheduledState"
      | "isOngoingState"
      | "isEndedState"
      | "isResolvedState",
  ): ScheduledMaintenanceState => {
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.id = ObjectID.generate();
    state.projectId = projectId;
    state.name = name;
    state.order = order;
    state[flag] = true;
    return state;
  };

  const scheduled: ScheduledMaintenanceState = build(
    "Scheduled",
    1,
    "isScheduledState",
  );
  const ongoing: ScheduledMaintenanceState = build(
    "Ongoing",
    2,
    "isOngoingState",
  );
  const ended: ScheduledMaintenanceState = build("Ended", 3, "isEndedState");
  const completed: ScheduledMaintenanceState = build(
    "Completed",
    4,
    "isResolvedState",
  );

  const readSpy: AnySpy = jest
    .spyOn(ScheduledMaintenanceStateService, "getAllScheduledMaintenanceStates")
    .mockResolvedValue([scheduled, ongoing, ended, completed]) as AnySpy;

  return {
    scheduled: scheduled,
    ongoing: ongoing,
    ended: ended,
    completed: completed,
    readSpy: readSpy,
  };
}

/*
 * Everything a kind of record differs in: how it is read, what its state
 * timeline row is called and how its columns are named, and the sentence its
 * refusals use.
 */
interface RecordKind {
  name: string;
  type: WorkspaceEventType;
  noun: string;
  subject: string;
  // Stubs the member's read of the record; null is a record they may not read.
  stubRead: (currentStateId: ObjectID | null) => AnySpy;
  // Stubs the state timeline create.
  stubCreate: () => AnySpy;
  recordColumn: string;
  stateColumn: string;
  triggerColumn: string | null;
  userNotificationEventType: UserNotificationEventType | null;
}

function readOf(data: {
  service: unknown;
  makeRecord: () => {
    id: ObjectID | null;
    projectId?: ObjectID | undefined;
  } & Record<string, unknown>;
  stateColumn: string;
}): (currentStateId: ObjectID | null) => AnySpy {
  return (currentStateId: ObjectID | null): AnySpy => {
    const spy: AnySpy = jest.spyOn(
      data.service as { findOneBy: () => Promise<unknown> },
      "findOneBy",
    ) as AnySpy;

    if (currentStateId === null) {
      return spy.mockResolvedValue(null);
    }

    const record: Record<string, unknown> = data.makeRecord();
    record["id"] = ObjectID.generate();
    record["projectId"] = projectId;
    record[data.stateColumn] = currentStateId;
    return spy.mockResolvedValue(record);
  };
}

function createOf(service: unknown): () => AnySpy {
  return (): AnySpy => {
    return (
      jest.spyOn(
        service as { create: () => Promise<unknown> },
        "create",
      ) as AnySpy
    ).mockImplementation(async (createBy: unknown): Promise<unknown> => {
      return (createBy as { data: unknown }).data;
    });
  };
}

const RECORD_KINDS: Array<RecordKind> = [
  {
    name: "an incident",
    type: WorkspaceEventType.Incident,
    noun: "incident",
    subject: "Incident",
    stubRead: readOf({
      service: IncidentService,
      makeRecord: (): Incident & Record<string, unknown> => {
        return new Incident() as Incident & Record<string, unknown>;
      },
      stateColumn: "currentIncidentStateId",
    }),
    stubCreate: createOf(IncidentStateTimelineService),
    recordColumn: "incidentId",
    stateColumn: "incidentStateId",
    triggerColumn: "triggeredByIncidentId",
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
  },
  {
    name: "an alert",
    type: WorkspaceEventType.Alert,
    noun: "alert",
    subject: "Alert",
    stubRead: readOf({
      service: AlertService,
      makeRecord: (): Alert & Record<string, unknown> => {
        return new Alert() as Alert & Record<string, unknown>;
      },
      stateColumn: "currentAlertStateId",
    }),
    stubCreate: createOf(AlertStateTimelineService),
    recordColumn: "alertId",
    stateColumn: "alertStateId",
    triggerColumn: "triggeredByAlertId",
    userNotificationEventType: UserNotificationEventType.AlertCreated,
  },
  {
    name: "an incident episode",
    type: WorkspaceEventType.IncidentEpisode,
    noun: "incident episode",
    subject: "Episode",
    stubRead: readOf({
      service: IncidentEpisodeService,
      makeRecord: (): IncidentEpisode & Record<string, unknown> => {
        return new IncidentEpisode() as IncidentEpisode &
          Record<string, unknown>;
      },
      stateColumn: "currentIncidentStateId",
    }),
    stubCreate: createOf(IncidentEpisodeStateTimelineService),
    recordColumn: "incidentEpisodeId",
    stateColumn: "incidentStateId",
    triggerColumn: "triggeredByIncidentEpisodeId",
    userNotificationEventType: UserNotificationEventType.IncidentEpisodeCreated,
  },
  {
    name: "an alert episode",
    type: WorkspaceEventType.AlertEpisode,
    noun: "alert episode",
    subject: "Episode",
    stubRead: readOf({
      service: AlertEpisodeService,
      makeRecord: (): AlertEpisode & Record<string, unknown> => {
        return new AlertEpisode() as AlertEpisode & Record<string, unknown>;
      },
      stateColumn: "currentAlertStateId",
    }),
    stubCreate: createOf(AlertEpisodeStateTimelineService),
    recordColumn: "alertEpisodeId",
    stateColumn: "alertStateId",
    triggerColumn: "triggeredByAlertEpisodeId",
    userNotificationEventType: UserNotificationEventType.AlertEpisodeCreated,
  },
  {
    name: "a scheduled maintenance event",
    type: WorkspaceEventType.ScheduledMaintenance,
    noun: "scheduled maintenance event",
    subject: "Scheduled maintenance event",
    stubRead: readOf({
      service: ScheduledMaintenanceService,
      makeRecord: (): ScheduledMaintenance & Record<string, unknown> => {
        return new ScheduledMaintenance() as ScheduledMaintenance &
          Record<string, unknown>;
      },
      stateColumn: "currentScheduledMaintenanceStateId",
    }),
    stubCreate: createOf(ScheduledMaintenanceStateTimelineService),
    recordColumn: "scheduledMaintenanceId",
    stateColumn: "scheduledMaintenanceStateId",
    triggerColumn: null,
    userNotificationEventType: null,
  },
];

// The kinds Acknowledge and Resolve move along a list of incident or alert states.
interface ListKind {
  kind: RecordKind;
  stubStates: () => IncidentLikeStates<IncidentState | AlertState>;
}

const LIST_KINDS: Array<ListKind> = RECORD_KINDS.filter(
  (kind: RecordKind): boolean => {
    return kind.type !== WorkspaceEventType.ScheduledMaintenance;
  },
).map((kind: RecordKind): ListKind => {
  const isIncidentList: boolean =
    kind.type === WorkspaceEventType.Incident ||
    kind.type === WorkspaceEventType.IncidentEpisode;

  return {
    kind: kind,
    stubStates: (): IncidentLikeStates<IncidentState | AlertState> => {
      if (isIncidentList) {
        const states: IncidentLikeStates<IncidentState> = incidentLikeStates(
          (): IncidentState => {
            return new IncidentState();
          },
        );
        jest
          .spyOn(IncidentStateService, "getAllIncidentStates")
          .mockResolvedValue(states.all);
        return states;
      }

      const states: IncidentLikeStates<AlertState> = incidentLikeStates(
        (): AlertState => {
          return new AlertState();
        },
      );
      jest
        .spyOn(AlertStateService, "getAllAlertStates")
        .mockResolvedValue(states.all);
      return states;
    },
  };
});

// The one create call a spy saw: its data, as JSON, and its props.
function createdRow(createSpy: AnySpy): {
  data: JSONObject;
  props: DatabaseCommonInteractionProps;
} {
  expect(createSpy).toHaveBeenCalledTimes(1);
  const createBy: {
    data: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  } = createSpy.mock.calls[0]![0];
  const data: JSONObject = {};

  // The columns the row was given; the model's own bookkeeping is not one.
  for (const [key, value] of Object.entries(createBy.data)) {
    if (value === undefined || value === null || key === "isPermissionIf") {
      continue;
    }

    data[key] = value instanceof ObjectID ? value.toString() : (value as any);
  }

  return { data: data, props: createBy.props };
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("WorkspaceMemberActions.changeState", (): void => {
  test.each(RECORD_KINDS)(
    "moves $name into the picked state with a state timeline row the member creates",
    async (kind: RecordKind): Promise<void> => {
      const recordId: ObjectID = ObjectID.generate();
      const stateId: ObjectID = ObjectID.generate();
      const readSpy: AnySpy = kind.stubRead(ObjectID.generate());
      const createSpy: AnySpy = kind.stubCreate();

      await WorkspaceMemberActions.changeState({
        event: { type: kind.type, id: recordId },
        stateId: stateId,
        props: memberProps,
      });

      // The record is read as the member, in their project.
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy.mock.calls[0]![0].props).toBe(memberProps);
      expect(readSpy.mock.calls[0]![0].query).toEqual({
        _id: recordId.toString(),
        projectId: projectId,
      });

      // The row the dashboard's state panel creates: nothing more.
      const created: {
        data: JSONObject;
        props: DatabaseCommonInteractionProps;
      } = createdRow(createSpy);
      expect(created.data).toEqual({
        projectId: projectId.toString(),
        [kind.recordColumn]: recordId.toString(),
        [kind.stateColumn]: stateId.toString(),
      });
      // With the member's own props: they are its creator.
      expect(created.props).toBe(memberProps);
      expect(created.props.isRoot).toBeUndefined();
    },
  );

  test.each(RECORD_KINDS)(
    "refuses $name the member may not read, like one that is not there, and writes nothing",
    async (kind: RecordKind): Promise<void> => {
      kind.stubRead(null);
      const createSpy: AnySpy = kind.stubCreate();

      await expect(
        WorkspaceMemberActions.changeState({
          event: { type: kind.type, id: ObjectID.generate() },
          stateId: ObjectID.generate(),
          props: memberProps,
        }),
      ).rejects.toThrow(
        new NotAuthorizedException(
          `The ${kind.noun} was not found in this project, or you do not have access to it.`,
        ),
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test.each(RECORD_KINDS)(
    "answers a read of $name the member's permissions or plan refuse with the same sentence",
    async (kind: RecordKind): Promise<void> => {
      const readSpy: AnySpy = kind.stubRead(null);
      const createSpy: AnySpy = kind.stubCreate();

      for (const refusal of [
        new NotAuthorizedException("You do not have permissions to read."),
        new PaymentRequiredException("Upgrade your plan."),
      ]) {
        readSpy.mockRejectedValueOnce(refusal);

        await expect(
          WorkspaceMemberActions.changeState({
            event: { type: kind.type, id: ObjectID.generate() },
            stateId: ObjectID.generate(),
            props: memberProps,
          }),
        ).rejects.toThrow(
          `The ${kind.noun} was not found in this project, or you do not have access to it.`,
        );
      }

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("a read that fails for another reason is not answered as a refusal", async (): Promise<void> => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockRejectedValue(new Error("connect ECONNREFUSED"));
    const createSpy: AnySpy = createOf(IncidentStateTimelineService)();

    await expect(
      WorkspaceMemberActions.changeState({
        event: { type: WorkspaceEventType.Incident, id: ObjectID.generate() },
        stateId: ObjectID.generate(),
        props: memberProps,
      }),
    ).rejects.toThrow("connect ECONNREFUSED");

    expect(createSpy).not.toHaveBeenCalled();
  });

  test.each([
    { name: "no user", props: { tenantId: projectId } },
    { name: "no project", props: { userId: userId } },
    { name: "OneUptime itself", props: { isRoot: true } },
  ])(
    "props with $name are refused before anything is read",
    async ({
      props,
    }: {
      props: DatabaseCommonInteractionProps;
    }): Promise<void> => {
      const readSpy: AnySpy = jest.spyOn(
        IncidentService,
        "findOneBy",
      ) as AnySpy;
      const createSpy: AnySpy = createOf(IncidentStateTimelineService)();

      await expect(
        WorkspaceMemberActions.changeState({
          event: { type: WorkspaceEventType.Incident, id: ObjectID.generate() },
          stateId: ObjectID.generate(),
          props: props,
        }),
      ).rejects.toThrow(
        new NotAuthorizedException(
          "You do not have permission to change this incident.",
        ),
      );

      expect(readSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("a refusal from the create itself reaches the caller as it is", async (): Promise<void> => {
    RECORD_KINDS[0]!.stubRead(ObjectID.generate());
    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockRejectedValue(
        new BadDataException(
          "Incident cannot transition to Created state from Resolved state because Created is before Resolved in the order of incident states.",
        ),
      );

    await expect(
      WorkspaceMemberActions.changeState({
        event: { type: WorkspaceEventType.Incident, id: ObjectID.generate() },
        stateId: ObjectID.generate(),
        props: memberProps,
      }),
    ).rejects.toThrow(
      "Incident cannot transition to Created state from Resolved state",
    );
  });
});

describe("WorkspaceMemberActions.acknowledge", (): void => {
  test.each(LIST_KINDS)(
    "moves $kind.name into the project's acknowledged state as the member",
    async ({ kind, stubStates }: ListKind): Promise<void> => {
      const states: IncidentLikeStates<IncidentState | AlertState> =
        stubStates();
      const recordId: ObjectID = ObjectID.generate();
      kind.stubRead(states.created.id!);
      const createSpy: AnySpy = kind.stubCreate();

      await WorkspaceMemberActions.acknowledge({
        event: { type: kind.type, id: recordId },
        props: memberProps,
      });

      const created: {
        data: JSONObject;
        props: DatabaseCommonInteractionProps;
      } = createdRow(createSpy);
      expect(created.data).toEqual({
        projectId: projectId.toString(),
        [kind.recordColumn]: recordId.toString(),
        [kind.stateColumn]: states.acknowledged.id!.toString(),
      });
      expect(created.props).toBe(memberProps);
    },
  );

  test.each(LIST_KINDS)(
    "refuses $kind.name acknowledged already - or further along - in the services' own words",
    async ({ kind, stubStates }: ListKind): Promise<void> => {
      const states: IncidentLikeStates<IncidentState | AlertState> =
        stubStates();
      const createSpy: AnySpy = kind.stubCreate();

      for (const [state, refusal] of [
        [states.acknowledged, `${kind.subject} is already acknowledged.`],
        // A state of the project's own after Acknowledged counts as acknowledged.
        [states.investigating, `${kind.subject} is already acknowledged.`],
        [states.resolved, `${kind.subject} is already resolved.`],
      ] as Array<[IncidentState | AlertState, string]>) {
        kind.stubRead(state.id!);

        await expect(
          WorkspaceMemberActions.acknowledge({
            event: { type: kind.type, id: ObjectID.generate() },
            props: memberProps,
          }),
        ).rejects.toThrow(new BadDataException(refusal));
      }

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test.each(LIST_KINDS)(
    "refuses $kind.name the member may not read before its state is told",
    async ({ kind, stubStates }: ListKind): Promise<void> => {
      stubStates();
      kind.stubRead(null);
      const createSpy: AnySpy = kind.stubCreate();

      await expect(
        WorkspaceMemberActions.acknowledge({
          event: { type: kind.type, id: ObjectID.generate() },
          props: memberProps,
        }),
      ).rejects.toThrow(
        `The ${kind.noun} was not found in this project, or you do not have access to it.`,
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("says so when the project has no acknowledged state", async (): Promise<void> => {
    const states: IncidentLikeStates<IncidentState> = incidentLikeStates(
      (): IncidentState => {
        return new IncidentState();
      },
    );
    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockResolvedValue([states.created, states.resolved]);
    RECORD_KINDS[0]!.stubRead(states.created.id!);
    const createSpy: AnySpy = RECORD_KINDS[0]!.stubCreate();

    await expect(
      WorkspaceMemberActions.acknowledge({
        event: { type: WorkspaceEventType.Incident, id: ObjectID.generate() },
        props: memberProps,
      }),
    ).rejects.toThrow("Acknowledged state not found for this project.");

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a scheduled maintenance event cannot be acknowledged, and nothing is read or written", async (): Promise<void> => {
    const readSpy: AnySpy = jest.spyOn(
      ScheduledMaintenanceService,
      "findOneBy",
    ) as AnySpy;
    const createSpy: AnySpy = createOf(
      ScheduledMaintenanceStateTimelineService,
    )();

    await expect(
      WorkspaceMemberActions.acknowledge({
        event: {
          type: WorkspaceEventType.ScheduledMaintenance,
          id: ObjectID.generate(),
        },
        props: memberProps,
      }),
    ).rejects.toThrow(
      new BadDataException(
        "A scheduled maintenance event cannot be acknowledged.",
      ),
    );

    expect(readSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("WorkspaceMemberActions.resolve", (): void => {
  test.each(LIST_KINDS)(
    "moves $kind.name into the project's resolved state as the member, from any state before it",
    async ({ kind, stubStates }: ListKind): Promise<void> => {
      const states: IncidentLikeStates<IncidentState | AlertState> =
        stubStates();

      for (const from of [
        states.created,
        states.acknowledged,
        states.investigating,
      ]) {
        const recordId: ObjectID = ObjectID.generate();
        kind.stubRead(from.id!);
        const createSpy: AnySpy = kind.stubCreate();

        await WorkspaceMemberActions.resolve({
          event: { type: kind.type, id: recordId },
          props: memberProps,
        });

        const created: {
          data: JSONObject;
          props: DatabaseCommonInteractionProps;
        } = createdRow(createSpy);
        expect(created.data).toEqual({
          projectId: projectId.toString(),
          [kind.recordColumn]: recordId.toString(),
          [kind.stateColumn]: states.resolved.id!.toString(),
        });
        expect(created.props).toBe(memberProps);

        createSpy.mockRestore();
      }
    },
  );

  test.each(LIST_KINDS)(
    "refuses $kind.name resolved already",
    async ({ kind, stubStates }: ListKind): Promise<void> => {
      const states: IncidentLikeStates<IncidentState | AlertState> =
        stubStates();
      kind.stubRead(states.resolved.id!);
      const createSpy: AnySpy = kind.stubCreate();

      await expect(
        WorkspaceMemberActions.resolve({
          event: { type: kind.type, id: ObjectID.generate() },
          props: memberProps,
        }),
      ).rejects.toThrow(
        new BadDataException(`${kind.subject} is already resolved.`),
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("Mark as Complete moves a scheduled maintenance event into its completed state as the member", async (): Promise<void> => {
    const states: MaintenanceStates = maintenanceStates();
    const recordId: ObjectID = ObjectID.generate();
    RECORD_KINDS[4]!.stubRead(states.ongoing.id!);
    const createSpy: AnySpy = RECORD_KINDS[4]!.stubCreate();

    await WorkspaceMemberActions.resolve({
      event: { type: WorkspaceEventType.ScheduledMaintenance, id: recordId },
      props: memberProps,
    });

    // The project's states, as OneUptime reads them: the move is the project's rule.
    expect(states.readSpy.mock.calls[0]![0].projectId).toBe(projectId);
    expect(states.readSpy.mock.calls[0]![0].props).toEqual({ isRoot: true });
    const created: {
      data: JSONObject;
      props: DatabaseCommonInteractionProps;
    } = createdRow(createSpy);
    expect(created.data).toEqual({
      projectId: projectId.toString(),
      scheduledMaintenanceId: recordId.toString(),
      scheduledMaintenanceStateId: states.completed.id!.toString(),
    });
    expect(created.props).toBe(memberProps);
  });

  test("a completed scheduled maintenance event is not completed again", async (): Promise<void> => {
    const states: MaintenanceStates = maintenanceStates();
    RECORD_KINDS[4]!.stubRead(states.completed.id!);
    const createSpy: AnySpy = RECORD_KINDS[4]!.stubCreate();

    await expect(
      WorkspaceMemberActions.resolve({
        event: {
          type: WorkspaceEventType.ScheduledMaintenance,
          id: ObjectID.generate(),
        },
        props: memberProps,
      }),
    ).rejects.toThrow(
      new BadDataException("Scheduled maintenance event is already complete."),
    );

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a scheduled maintenance event the member may not read is refused before its state is read", async (): Promise<void> => {
    RECORD_KINDS[4]!.stubRead(null);
    const completedSpy: AnySpy = maintenanceStates().readSpy;
    const createSpy: AnySpy = RECORD_KINDS[4]!.stubCreate();

    await expect(
      WorkspaceMemberActions.resolve({
        event: {
          type: WorkspaceEventType.ScheduledMaintenance,
          id: ObjectID.generate(),
        },
        props: memberProps,
      }),
    ).rejects.toThrow(
      "The scheduled maintenance event was not found in this project, or you do not have access to it.",
    );

    expect(completedSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("WorkspaceMemberActions.markScheduledMaintenanceAsOngoing", (): void => {
  function maintenanceEvent(id: ObjectID): {
    type: WorkspaceEventType;
    id: ObjectID;
  } {
    return { type: WorkspaceEventType.ScheduledMaintenance, id: id };
  }

  test("moves the event into the project's ongoing state as the member", async (): Promise<void> => {
    const states: MaintenanceStates = maintenanceStates();
    const recordId: ObjectID = ObjectID.generate();
    RECORD_KINDS[4]!.stubRead(states.scheduled.id!);
    const createSpy: AnySpy = RECORD_KINDS[4]!.stubCreate();

    await WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
      event: maintenanceEvent(recordId),
      props: memberProps,
    });

    const created: {
      data: JSONObject;
      props: DatabaseCommonInteractionProps;
    } = createdRow(createSpy);
    expect(created.data).toEqual({
      projectId: projectId.toString(),
      scheduledMaintenanceId: recordId.toString(),
      scheduledMaintenanceStateId: states.ongoing.id!.toString(),
    });
    expect(created.props).toBe(memberProps);
  });

  test.each([
    {
      label: "ongoing",
      state: "ongoing" as const,
      refusal: "Scheduled maintenance event is already ongoing.",
    },
    {
      label: "ended",
      state: "ended" as const,
      refusal: "Scheduled maintenance event is already ongoing.",
    },
    {
      label: "complete",
      state: "completed" as const,
      refusal: "Scheduled maintenance event is already complete.",
    },
  ])(
    "an event that is $label is refused with what it is, and nothing is written",
    async ({
      state,
      refusal,
    }: {
      state: "ongoing" | "ended" | "completed";
      refusal: string;
    }): Promise<void> => {
      const states: MaintenanceStates = maintenanceStates();
      RECORD_KINDS[4]!.stubRead(states[state].id!);
      const createSpy: AnySpy = RECORD_KINDS[4]!.stubCreate();

      await expect(
        WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
          event: maintenanceEvent(ObjectID.generate()),
          props: memberProps,
        }),
      ).rejects.toThrow(new BadDataException(refusal));

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("an event the member may not read is refused before anything about it is read", async (): Promise<void> => {
    RECORD_KINDS[4]!.stubRead(null);
    const statesRead: AnySpy = maintenanceStates().readSpy;
    const createSpy: AnySpy = RECORD_KINDS[4]!.stubCreate();

    await expect(
      WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
        event: maintenanceEvent(ObjectID.generate()),
        props: memberProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(statesRead).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("only a scheduled maintenance event is marked as ongoing", async (): Promise<void> => {
    const readSpy: AnySpy = RECORD_KINDS[0]!.stubRead(ObjectID.generate());

    await expect(
      WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
        event: { type: WorkspaceEventType.Incident, id: ObjectID.generate() },
        props: memberProps,
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(readSpy).not.toHaveBeenCalled();
  });
});

/*
 * A press reads its record once: the check that the member may act
 * (authorize) reads it with what the actions need, and an action handed
 * that record reads nothing of it again. Only a record this class read for
 * the member, in their project, is taken as read: one built by hand, or read
 * for another member or in another project, is read again as the member.
 */
describe("WorkspaceMemberActions: the record as the check read it", (): void => {
  // The row the check reads for `kind`: the columns getEventResource names.
  function rowAsChecked(data: {
    kind: RecordKind;
    id: ObjectID;
    currentStateId: ObjectID;
  }): Record<string, unknown> {
    const resource: ReturnType<typeof WorkspaceMemberActions.getEventResource> =
      WorkspaceMemberActions.getEventResource({
        type: data.kind.type,
        id: data.id,
      });
    const row: Record<string, unknown> = {
      _id: data.id.toString(),
      projectId: projectId,
    };

    for (const column of Object.keys(resource.select || {})) {
      row[column] = column.toLowerCase().includes("state")
        ? data.currentStateId
        : column.endsWith("WithPrefix")
          ? "PFX-7"
          : 7;
    }

    return row;
  }

  /*
   * The record as authorize hands it on: read by the check as the member -
   * or as `props` - in their project.
   */
  async function recordAsRead(data: {
    kind: RecordKind;
    currentStateId: ObjectID;
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<WorkspaceEventRecord> {
    const id: ObjectID = ObjectID.generate();
    const checkSpy: AnySpy = jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreateAndRead")
      .mockResolvedValue([
        rowAsChecked({
          kind: data.kind,
          id: id,
          currentStateId: data.currentStateId,
        }) as never,
      ]) as AnySpy;

    const record: WorkspaceEventRecord = await WorkspaceMemberActions.authorize(
      {
        props: data.props || memberProps,
        modelType: IncidentStateTimeline,
        action: "change this",
        event: { type: data.kind.type, id: id },
      },
    );

    checkSpy.mockRestore();

    return record;
  }

  // A record with everything a read one carries - the member's project too.
  function recordBuiltByHand(kind: RecordKind): WorkspaceEventRecord {
    return {
      type: kind.type,
      id: ObjectID.generate(),
      projectId: projectId,
      currentStateId: ObjectID.generate(),
      number: 7,
      numberWithPrefix: null,
    };
  }

  test.each(RECORD_KINDS)(
    "a state change of $name made from the check's read reads the record no more",
    async (kind: RecordKind): Promise<void> => {
      const readSpy: AnySpy = kind.stubRead(ObjectID.generate());
      const createSpy: AnySpy = kind.stubCreate();
      const record: WorkspaceEventRecord = await recordAsRead({
        kind: kind,
        currentStateId: ObjectID.generate(),
      });
      const stateId: ObjectID = ObjectID.generate();

      await WorkspaceMemberActions.changeState({
        event: record,
        stateId: stateId,
        props: memberProps,
      });

      expect(readSpy).not.toHaveBeenCalled();
      expect(createdRow(createSpy).data).toEqual({
        projectId: projectId.toString(),
        [kind.recordColumn]: record.id.toString(),
        [kind.stateColumn]: stateId.toString(),
      });
    },
  );

  test.each(LIST_KINDS)(
    "Acknowledge and Resolve of $kind.name from the check's read read only the project's states",
    async ({ kind, stubStates }: ListKind): Promise<void> => {
      const states: IncidentLikeStates<IncidentState | AlertState> =
        stubStates();
      const readSpy: AnySpy = kind.stubRead(states.created.id!);

      for (const move of ["acknowledge", "resolve"] as const) {
        const createSpy: AnySpy = kind.stubCreate();

        await WorkspaceMemberActions[move]({
          event: await recordAsRead({
            kind: kind,
            currentStateId: states.created.id!,
          }),
          props: memberProps,
        });

        expect(createdRow(createSpy).data[kind.stateColumn]).toBe(
          (move === "acknowledge"
            ? states.acknowledged
            : states.resolved
          ).id!.toString(),
        );
        createSpy.mockRestore();
      }

      expect(readSpy).not.toHaveBeenCalled();
    },
  );

  test("Mark as Ongoing and Mark as Complete from the check's read read only the project's states", async (): Promise<void> => {
    const states: MaintenanceStates = maintenanceStates();
    const readSpy: AnySpy = RECORD_KINDS[4]!.stubRead(states.scheduled.id!);
    const createSpy: AnySpy = RECORD_KINDS[4]!.stubCreate();

    await WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
      event: await recordAsRead({
        kind: RECORD_KINDS[4]!,
        currentStateId: states.scheduled.id!,
      }),
      props: memberProps,
    });
    await WorkspaceMemberActions.resolve({
      event: await recordAsRead({
        kind: RECORD_KINDS[4]!,
        currentStateId: states.ongoing.id!,
      }),
      props: memberProps,
    });

    expect(readSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(
      String(createSpy.mock.calls[0]![0].data.scheduledMaintenanceStateId),
    ).toBe(states.ongoing.id!.toString());
    expect(
      String(createSpy.mock.calls[1]![0].data.scheduledMaintenanceStateId),
    ).toBe(states.completed.id!.toString());
  });

  test.each(RECORD_KINDS)(
    "a record of $name built by hand is read again, as the member, before anything is written",
    async (kind: RecordKind): Promise<void> => {
      const readSpy: AnySpy = kind.stubRead(ObjectID.generate());
      const createSpy: AnySpy = kind.stubCreate();
      const record: WorkspaceEventRecord = recordBuiltByHand(kind);

      await WorkspaceMemberActions.changeState({
        event: record,
        stateId: ObjectID.generate(),
        props: memberProps,
      });

      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy.mock.calls[0]![0].props).toBe(memberProps);
      expect(readSpy.mock.calls[0]![0].query).toEqual({
        _id: record.id.toString(),
        projectId: projectId,
      });
      expect(createSpy).toHaveBeenCalledTimes(1);
    },
  );

  test.each(RECORD_KINDS)(
    "a record of $name built by hand that the member may not read is refused, and nothing is written",
    async (kind: RecordKind): Promise<void> => {
      kind.stubRead(null);
      const createSpy: AnySpy = kind.stubCreate();

      await expect(
        WorkspaceMemberActions.changeState({
          event: recordBuiltByHand(kind),
          stateId: ObjectID.generate(),
          props: memberProps,
        }),
      ).rejects.toThrow(
        new NotAuthorizedException(
          `The ${kind.noun} was not found in this project, or you do not have access to it.`,
        ),
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("a copy of a record read for the member is read again: only the record the read handed on counts", async (): Promise<void> => {
    const kind: RecordKind = RECORD_KINDS[0]!;
    const record: WorkspaceEventRecord = await recordAsRead({
      kind: kind,
      currentStateId: ObjectID.generate(),
    });
    const readSpy: AnySpy = kind.stubRead(ObjectID.generate());
    kind.stubCreate();

    await WorkspaceMemberActions.changeState({
      event: { ...record },
      stateId: ObjectID.generate(),
      props: memberProps,
    });

    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  test("a record read for the member cannot be changed afterwards", async (): Promise<void> => {
    const record: WorkspaceEventRecord = await recordAsRead({
      kind: RECORD_KINDS[0]!,
      currentStateId: ObjectID.generate(),
    });
    const readState: ObjectID | undefined = record.currentStateId;

    expect((): void => {
      record.currentStateId = ObjectID.generate();
    }).toThrow(TypeError);
    expect((): void => {
      record.projectId = ObjectID.generate();
    }).toThrow(TypeError);
    expect(record.currentStateId).toBe(readState);
    expect(record.projectId).toBe(projectId);
  });

  test("a record read for another member is read again, as this one", async (): Promise<void> => {
    const kind: RecordKind = RECORD_KINDS[0]!;
    const record: WorkspaceEventRecord = await recordAsRead({
      kind: kind,
      currentStateId: ObjectID.generate(),
      props: { userId: ObjectID.generate(), tenantId: projectId },
    });
    const readSpy: AnySpy = kind.stubRead(ObjectID.generate());
    const createSpy: AnySpy = kind.stubCreate();

    await WorkspaceMemberActions.changeState({
      event: record,
      stateId: ObjectID.generate(),
      props: memberProps,
    });

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy.mock.calls[0]![0].props).toBe(memberProps);
    expect(createdRow(createSpy).props).toBe(memberProps);
  });

  test("a record read in another project than the member's is read again, as the member, in theirs", async (): Promise<void> => {
    const kind: RecordKind = RECORD_KINDS[0]!;
    const record: WorkspaceEventRecord = await recordAsRead({
      kind: kind,
      currentStateId: ObjectID.generate(),
      props: { userId: userId, tenantId: ObjectID.generate() },
    });
    const readSpy: AnySpy = kind.stubRead(ObjectID.generate());
    const createSpy: AnySpy = kind.stubCreate();

    await WorkspaceMemberActions.changeState({
      event: record,
      stateId: ObjectID.generate(),
      props: memberProps,
    });

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy.mock.calls[0]![0].query).toEqual({
      _id: record.id.toString(),
      projectId: projectId,
    });
    expect(createdRow(createSpy).data["projectId"]).toBe(projectId.toString());
  });

  test.each(RECORD_KINDS)(
    "authorize reads $name once, with its state and number, through the check",
    async (kind: RecordKind): Promise<void> => {
      const resource: ReturnType<
        typeof WorkspaceMemberActions.getEventResource
      > = WorkspaceMemberActions.getEventResource({
        type: kind.type,
        id: ObjectID.generate(),
      });
      const stateId: ObjectID = ObjectID.generate();
      const read: Record<string, unknown> = rowAsChecked({
        kind: kind,
        id: resource.id,
        currentStateId: stateId,
      });

      // The columns the check reads, named per kind.
      expect(Object.keys(resource.select || {})).toHaveLength(3);

      const checkSpy: AnySpy = jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreateAndRead")
        .mockResolvedValue([read as never]) as AnySpy;

      const record: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: memberProps,
          modelType: IncidentStateTimeline,
          action: "change this",
          event: { type: kind.type, id: resource.id },
        });

      expect(checkSpy).toHaveBeenCalledTimes(1);
      expect(checkSpy.mock.calls[0]![0].resources[0].select).toEqual(
        resource.select,
      );
      expect(record).toEqual({
        type: kind.type,
        id: resource.id,
        projectId: projectId,
        currentStateId: stateId,
        number: 7,
        numberWithPrefix: "PFX-7",
      });
    },
  );

  test.each([
    { name: "no user", props: { tenantId: projectId } },
    { name: "no project", props: { userId: userId } },
  ])(
    "authorize does not hand on a record for props with $name",
    async ({
      props,
    }: {
      props: DatabaseCommonInteractionProps;
    }): Promise<void> => {
      await expect(
        recordAsRead({
          kind: RECORD_KINDS[0]!,
          currentStateId: ObjectID.generate(),
          props: props,
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );
});

/*
 * A chat that shows the record before acting on it (Microsoft Teams' View
 * and Mark as Ongoing on a scheduled maintenance event) reads it once, as the
 * member, with what it shows and what the actions need.
 */
describe("WorkspaceMemberActions.findEventForMember", (): void => {
  test("reads the record as the member, with the columns asked for and those the actions need, and the actions take it as read", async (): Promise<void> => {
    const states: MaintenanceStates = maintenanceStates();
    const readSpy: AnySpy = RECORD_KINDS[4]!.stubRead(states.scheduled.id!);
    const createSpy: AnySpy = RECORD_KINDS[4]!.stubCreate();
    const recordId: ObjectID = ObjectID.generate();

    const found: {
      record: ScheduledMaintenance;
      event: WorkspaceEventRecord;
    } | null =
      await WorkspaceMemberActions.findEventForMember<ScheduledMaintenance>({
        event: {
          type: WorkspaceEventType.ScheduledMaintenance,
          id: recordId,
        },
        props: memberProps,
        select: { title: true },
      });

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy.mock.calls[0]![0].props).toBe(memberProps);
    expect(readSpy.mock.calls[0]![0].query).toEqual({
      _id: recordId.toString(),
      projectId: projectId,
    });
    expect(readSpy.mock.calls[0]![0].select).toEqual({
      title: true,
      currentScheduledMaintenanceStateId: true,
      scheduledMaintenanceNumber: true,
      scheduledMaintenanceNumberWithPrefix: true,
      _id: true,
    });
    expect(found?.event).toEqual({
      type: WorkspaceEventType.ScheduledMaintenance,
      id: recordId,
      projectId: projectId,
      currentStateId: states.scheduled.id!,
      number: null,
      numberWithPrefix: null,
    });

    await WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
      event: found!.event,
      props: memberProps,
    });

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(createdRow(createSpy).data["scheduledMaintenanceStateId"]).toBe(
      states.ongoing.id!.toString(),
    );
  });

  test.each(RECORD_KINDS)(
    "$name the member may not read is none",
    async (kind: RecordKind): Promise<void> => {
      kind.stubRead(null);

      await expect(
        WorkspaceMemberActions.findEventForMember({
          event: { type: kind.type, id: ObjectID.generate() },
          props: memberProps,
          select: {},
        }),
      ).resolves.toBeNull();
    },
  );

  test("a read the member's permissions or plan refuse is none; another failure is not", async (): Promise<void> => {
    const readSpy: AnySpy = RECORD_KINDS[0]!.stubRead(null);
    const find: () => Promise<unknown> = (): Promise<unknown> => {
      return WorkspaceMemberActions.findEventForMember({
        event: { type: WorkspaceEventType.Incident, id: ObjectID.generate() },
        props: memberProps,
        select: {},
      });
    };

    for (const refusal of [
      new NotAuthorizedException("You do not have permissions to read."),
      new PaymentRequiredException("Upgrade your plan."),
    ]) {
      readSpy.mockRejectedValueOnce(refusal);
      await expect(find()).resolves.toBeNull();
    }

    readSpy.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(find()).rejects.toThrow("connect ECONNREFUSED");
  });

  test("props without a member are refused before anything is read", async (): Promise<void> => {
    const readSpy: AnySpy = jest.spyOn(
      ScheduledMaintenanceService,
      "findOneBy",
    ) as AnySpy;

    await expect(
      WorkspaceMemberActions.findEventForMember({
        event: {
          type: WorkspaceEventType.ScheduledMaintenance,
          id: ObjectID.generate(),
        },
        props: { isRoot: true },
        select: {},
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe("WorkspaceMemberActions.getStanding", (): void => {
  test.each(LIST_KINDS)(
    "$kind.name is acknowledged from its acknowledged state on, and resolved in its resolved state",
    async ({ kind, stubStates }: ListKind): Promise<void> => {
      const states: IncidentLikeStates<IncidentState | AlertState> =
        stubStates();

      const standingIn: (
        state: IncidentState | AlertState,
      ) => Promise<WorkspaceEventStanding> = async (
        state: IncidentState | AlertState,
      ): Promise<WorkspaceEventStanding> => {
        return await WorkspaceMemberActions.getStanding({
          type: kind.type,
          id: ObjectID.generate(),
          projectId: projectId,
          currentStateId: state.id!,
          number: 1,
          numberWithPrefix: null,
        });
      };

      expect(await standingIn(states.created)).toMatchObject({
        isAcknowledged: false,
        isResolved: false,
      });
      expect(await standingIn(states.investigating)).toMatchObject({
        isAcknowledged: true,
        isResolved: false,
      });
      expect(await standingIn(states.resolved)).toMatchObject({
        isAcknowledged: true,
        isResolved: true,
      });
    },
  );

  test("a scheduled maintenance event has started from Ongoing on, and is complete in its completed state", async (): Promise<void> => {
    const states: MaintenanceStates = maintenanceStates();

    const standingIn: (
      state: ScheduledMaintenanceState,
    ) => Promise<WorkspaceEventStanding> = async (
      state: ScheduledMaintenanceState,
    ): Promise<WorkspaceEventStanding> => {
      return await WorkspaceMemberActions.getStanding({
        type: WorkspaceEventType.ScheduledMaintenance,
        id: ObjectID.generate(),
        projectId: projectId,
        currentStateId: state.id!,
        number: 1,
        numberWithPrefix: null,
      });
    };

    expect(await standingIn(states.scheduled)).toEqual({
      isAcknowledged: false,
      isResolved: false,
      hasStarted: false,
      isComplete: false,
    });
    expect(await standingIn(states.ended)).toMatchObject({
      hasStarted: true,
      isComplete: false,
    });
    expect(await standingIn(states.completed)).toMatchObject({
      hasStarted: true,
      isComplete: true,
    });
  });
});

describe("WorkspaceMemberActions.findStateOptions", (): void => {
  const STATE_LISTS: Array<{
    type: WorkspaceEventType;
    service: unknown;
  }> = [
    { type: WorkspaceEventType.Incident, service: IncidentStateService },
    {
      type: WorkspaceEventType.IncidentEpisode,
      service: IncidentStateService,
    },
    { type: WorkspaceEventType.Alert, service: AlertStateService },
    { type: WorkspaceEventType.AlertEpisode, service: AlertStateService },
    {
      type: WorkspaceEventType.ScheduledMaintenance,
      service: ScheduledMaintenanceStateService,
    },
  ];

  test.each(STATE_LISTS)(
    "lists the $type states the member may read, as the member, in the project's order",
    async ({
      type,
      service,
    }: {
      type: WorkspaceEventType;
      service: unknown;
    }): Promise<void> => {
      const first: StateRow = { id: ObjectID.generate(), name: "Created" };
      const second: StateRow = { id: ObjectID.generate(), name: "Resolved" };
      const findSpy: AnySpy = (
        jest.spyOn(
          service as { findBy: () => Promise<unknown> },
          "findBy",
        ) as AnySpy
      ).mockResolvedValue([
        { id: first.id, name: first.name },
        // A row without a name is no choice.
        { id: ObjectID.generate(), name: undefined },
        { id: second.id, name: second.name },
      ]);

      const options: Array<WorkspaceEventStateOption> =
        await WorkspaceMemberActions.findStateOptions({
          type: type,
          projectId: projectId,
          props: memberProps,
        });

      expect(options).toEqual([first, second]);
      expect(findSpy).toHaveBeenCalledTimes(1);
      expect(findSpy.mock.calls[0]![0].props).toBe(memberProps);
      expect(findSpy.mock.calls[0]![0].query).toEqual({
        projectId: projectId,
      });
      expect(findSpy.mock.calls[0]![0].sort).toEqual({
        order: SortOrder.Ascending,
      });
    },
  );

  test.each(STATE_LISTS)(
    "lists no $type states to a member whose read of them is refused",
    async ({
      type,
      service,
    }: {
      type: WorkspaceEventType;
      service: unknown;
    }): Promise<void> => {
      jest
        .spyOn(service as { findBy: () => Promise<unknown> }, "findBy")
        .mockRejectedValue(
          new NotAuthorizedException("You do not have permissions to read."),
        );

      await expect(
        WorkspaceMemberActions.findStateOptions({
          type: type,
          projectId: projectId,
          props: memberProps,
        }),
      ).resolves.toEqual([]);
    },
  );
});

describe("WorkspaceMemberActions.executeOnCallPolicy", (): void => {
  const EXECUTABLE_KINDS: Array<RecordKind> = RECORD_KINDS.filter(
    (kind: RecordKind): boolean => {
      return kind.triggerColumn !== null;
    },
  );

  test.each(EXECUTABLE_KINDS)(
    "creates the execution log for $name as the member, triggered by it",
    async (kind: RecordKind): Promise<void> => {
      const recordId: ObjectID = ObjectID.generate();
      const policyId: ObjectID = ObjectID.generate();
      kind.stubRead(ObjectID.generate());
      const createSpy: AnySpy = createOf(OnCallDutyPolicyExecutionLogService)();

      await WorkspaceMemberActions.executeOnCallPolicy({
        event: { type: kind.type, id: recordId },
        onCallDutyPolicyId: policyId,
        props: memberProps,
      });

      const created: {
        data: JSONObject;
        props: DatabaseCommonInteractionProps;
      } = createdRow(createSpy);
      // What the dashboard's Execute On-Call Policy creates: nothing more.
      expect(created.data).toEqual({
        projectId: projectId.toString(),
        onCallDutyPolicyId: policyId.toString(),
        [kind.triggerColumn!]: recordId.toString(),
        userNotificationEventType: kind.userNotificationEventType,
      });
      expect(createSpy.mock.calls[0]![0].data).toBeInstanceOf(
        OnCallDutyPolicyExecutionLog,
      );
      expect(created.props).toBe(memberProps);
    },
  );

  test.each(EXECUTABLE_KINDS)(
    "refuses $name the member may not read, and pages no one",
    async (kind: RecordKind): Promise<void> => {
      kind.stubRead(null);
      const createSpy: AnySpy = createOf(OnCallDutyPolicyExecutionLogService)();

      await expect(
        WorkspaceMemberActions.executeOnCallPolicy({
          event: { type: kind.type, id: ObjectID.generate() },
          onCallDutyPolicyId: ObjectID.generate(),
          props: memberProps,
        }),
      ).rejects.toThrow(
        `The ${kind.noun} was not found in this project, or you do not have access to it.`,
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("an on-call policy is not executed for a scheduled maintenance event", async (): Promise<void> => {
    RECORD_KINDS[4]!.stubRead(ObjectID.generate());
    const createSpy: AnySpy = createOf(OnCallDutyPolicyExecutionLogService)();

    await expect(
      WorkspaceMemberActions.executeOnCallPolicy({
        event: {
          type: WorkspaceEventType.ScheduledMaintenance,
          id: ObjectID.generate(),
        },
        onCallDutyPolicyId: ObjectID.generate(),
        props: memberProps,
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a refusal from the execution log's create - the policy, the plan - reaches the caller", async (): Promise<void> => {
    RECORD_KINDS[0]!.stubRead(ObjectID.generate());
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "create")
      .mockRejectedValue(
        new NotAuthorizedException(
          "The On-Call Policy you are trying to reference does not exist.",
        ),
      );

    await expect(
      WorkspaceMemberActions.executeOnCallPolicy({
        event: { type: WorkspaceEventType.Incident, id: ObjectID.generate() },
        onCallDutyPolicyId: ObjectID.generate(),
        props: memberProps,
      }),
    ).rejects.toThrow("does not exist");
  });
});

describe("WorkspaceMemberActions.getNoun", (): void => {
  test("names every kind of record for a sentence", (): void => {
    expect(
      RECORD_KINDS.map((kind: RecordKind): string => {
        return WorkspaceMemberActions.getNoun(kind.type);
      }),
    ).toEqual(
      RECORD_KINDS.map((kind: RecordKind): string => {
        return kind.noun;
      }),
    );
  });
});
