import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * IncidentService.acknowledgeIncident and AlertService.acknowledgeAlert act
 * with the props they are given, from the read of the record to the state
 * timeline row. OneUptime's own acknowledge - a responder answering an
 * on-call page - passes root props and credits the responder; a person's
 * props hold the whole call to that person, so a record they may not read
 * is answered like one that does not exist, and nothing is written.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const recordId: ObjectID = ObjectID.generate();

const createdStateId: ObjectID = ObjectID.generate();
const acknowledgedStateId: ObjectID = ObjectID.generate();
const resolvedStateId: ObjectID = ObjectID.generate();

const personProps: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: userId,
} as DatabaseCommonInteractionProps;

function statesOf<T extends IncidentState | AlertState>(modelType: {
  new (): T;
}): Array<T> {
  return [
    { id: createdStateId, order: 1, isCreatedState: true },
    { id: acknowledgedStateId, order: 2, isAcknowledgedState: true },
    { id: resolvedStateId, order: 3, isResolvedState: true },
  ].map(
    (row: {
      id: ObjectID;
      order: number;
      isCreatedState?: boolean;
      isAcknowledgedState?: boolean;
      isResolvedState?: boolean;
    }): T => {
      const state: T = new modelType();
      state._id = row.id.toString();
      state.order = row.order;
      state.isCreatedState = Boolean(row.isCreatedState);
      state.isAcknowledgedState = Boolean(row.isAcknowledgedState);
      state.isResolvedState = Boolean(row.isResolvedState);
      return state;
    },
  );
}

interface Kind {
  kind: string;
  notFound: string;
  // Serves the record (or none) to the service's own read.
  serve: (
    found: boolean,
  ) => jest.SpiedFunction<(...args: Array<never>) => Promise<unknown>>;
  // Watches the state timeline row the acknowledge creates.
  watchCreate: () => jest.SpiedFunction<
    (...args: Array<never>) => Promise<unknown>
  >;
  // Watches the read of the project's states.
  watchStates: () => jest.SpiedFunction<
    (...args: Array<never>) => Promise<unknown>
  >;
  acknowledge: (props: DatabaseCommonInteractionProps) => Promise<unknown>;
}

const KINDS: Array<Kind> = [
  {
    kind: "incident",
    notFound: "Incident not found.",
    serve: (found: boolean) => {
      let incident: Incident | null = null;

      if (found) {
        incident = new Incident();
        incident._id = recordId.toString();
        incident.projectId = projectId;
        incident.incidentNumber = 7;
        incident.currentIncidentStateId = createdStateId;
      }

      return jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue(incident as never) as never;
    },
    watchCreate: () => {
      return jest
        .spyOn(IncidentStateTimelineService, "create")
        .mockResolvedValue(new IncidentStateTimeline() as never) as never;
    },
    watchStates: () => {
      return jest
        .spyOn(IncidentStateService, "getAllIncidentStates")
        .mockResolvedValue(statesOf(IncidentState) as never) as never;
    },
    acknowledge: (props: DatabaseCommonInteractionProps) => {
      return IncidentService.acknowledgeIncident({
        incidentId: recordId,
        acknowledgedByUserId: userId,
        props: props,
      });
    },
  },
  {
    kind: "alert",
    notFound: "Alert not found.",
    serve: (found: boolean) => {
      let alert: Alert | null = null;

      if (found) {
        alert = new Alert();
        alert._id = recordId.toString();
        alert.projectId = projectId;
        alert.currentAlertStateId = createdStateId;
      }

      return jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue(alert as never) as never;
    },
    watchCreate: () => {
      return jest
        .spyOn(AlertStateTimelineService, "create")
        .mockResolvedValue(new AlertStateTimeline() as never) as never;
    },
    watchStates: () => {
      return jest
        .spyOn(AlertStateService, "getAllAlertStates")
        .mockResolvedValue(statesOf(AlertState) as never) as never;
    },
    acknowledge: (props: DatabaseCommonInteractionProps) => {
      return AlertService.acknowledgeAlert({
        alertId: recordId,
        acknowledgedByUserId: userId,
        props: props,
      });
    },
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("acknowledging an $kind", (kind: Kind) => {
  test("reads it with the props it was given, and writes nothing when that read finds nothing", async () => {
    const read: jest.SpiedFunction<
      (...args: Array<never>) => Promise<unknown>
    > = kind.serve(false);
    const states: jest.SpiedFunction<
      (...args: Array<never>) => Promise<unknown>
    > = kind.watchStates();
    const create: jest.SpiedFunction<
      (...args: Array<never>) => Promise<unknown>
    > = kind.watchCreate();

    await expect(kind.acknowledge(personProps)).rejects.toThrow(kind.notFound);

    expect(read).toHaveBeenCalledTimes(1);
    const asked: { props: DatabaseCommonInteractionProps } = read.mock
      .calls[0]![0] as unknown as { props: DatabaseCommonInteractionProps };
    expect(asked.props).toBe(personProps);
    expect(states).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("with a person's props, creates the state timeline row with them", async () => {
    kind.serve(true);
    kind.watchStates();
    const create: jest.SpiedFunction<
      (...args: Array<never>) => Promise<unknown>
    > = kind.watchCreate();

    await kind.acknowledge(personProps);

    expect(create).toHaveBeenCalledTimes(1);
    const written: { props: DatabaseCommonInteractionProps } = create.mock
      .calls[0]![0] as unknown as { props: DatabaseCommonInteractionProps };
    expect(written.props).toBe(personProps);
  });

  test("OneUptime's own acknowledge reads and writes as root, crediting the responder", async () => {
    const read: jest.SpiedFunction<
      (...args: Array<never>) => Promise<unknown>
    > = kind.serve(true);
    kind.watchStates();
    const create: jest.SpiedFunction<
      (...args: Array<never>) => Promise<unknown>
    > = kind.watchCreate();

    await kind.acknowledge({ isRoot: true });

    const asked: { props: DatabaseCommonInteractionProps } = read.mock
      .calls[0]![0] as unknown as { props: DatabaseCommonInteractionProps };
    expect(asked.props).toEqual({ isRoot: true });

    const written: {
      data: IncidentStateTimeline | AlertStateTimeline;
      props: DatabaseCommonInteractionProps;
    } = create.mock.calls[0]![0] as unknown as {
      data: IncidentStateTimeline | AlertStateTimeline;
      props: DatabaseCommonInteractionProps;
    };
    expect(written.props).toEqual({ isRoot: true });
    expect(written.data.createdByUserId?.toString()).toBe(userId.toString());
  });
});
