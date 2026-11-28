import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import {
  FormFollowUpRecordFacts,
  getFormFollowUpRecordKind,
  isFormFollowUpRecordType,
} from "../../../../Server/Utils/Form/FormFollowUpRecords";
import Color from "../../../../Types/Color";
import FormTargetType from "../../../../Types/Form/FormTargetType";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What the people following a request are told of the record it created
 * (Server/Utils/Form/FormFollowUpRecords, readFacts): its state's name and
 * colour, its number as the project shows it, and whether it is over -
 * decided by each list's own rule, never by a flag read on its own:
 *
 *   - an incident or an alert is closed when the project's rule says its
 *     state is resolved (Common/Utils/ResolvedState) - a state of the
 *     project's own placed after Resolved ("Closed") too;
 *   - a maintenance event is closed when it is over (ScheduledMaintenance-
 *     StartUtil.hasEnded) - ended, completed, or a state of the project's
 *     own after Ended ("Reviewing").
 *
 * The records and the rules are stood in for; everything is read as root.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1f2504e0-4f89-41d3-9a0c-0305e82c3301",
);
const RECORD_ID: ObjectID = new ObjectID(
  "2f2504e0-4f89-41d3-9a0c-0305e82c3302",
);
const STATE_ID: ObjectID = new ObjectID("3f2504e0-4f89-41d3-9a0c-0305e82c3303");
const OTHER_STATE_ID: ObjectID = new ObjectID(
  "4f2504e0-4f89-41d3-9a0c-0305e82c3304",
);

type FindOneByIdArgs = {
  id: ObjectID;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
};

const readFacts: (
  type: FormTargetType,
) => Promise<FormFollowUpRecordFacts | null> = (
  type: FormTargetType,
): Promise<FormFollowUpRecordFacts | null> => {
  return getFormFollowUpRecordKind(type).readFacts(RECORD_ID);
};

const findCall: (spy: unknown) => FindOneByIdArgs = (
  spy: unknown,
): FindOneByIdArgs => {
  return (spy as { mock: { calls: Array<Array<unknown>> } }).mock
    .calls[0]![0] as FindOneByIdArgs;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the records a follow-up can be about", () => {
  test("are the three a form can create, and nothing else", () => {
    expect(isFormFollowUpRecordType(FormTargetType.Incident)).toBe(true);
    expect(isFormFollowUpRecordType(FormTargetType.Alert)).toBe(true);
    expect(isFormFollowUpRecordType(FormTargetType.ScheduledMaintenance)).toBe(
      true,
    );
    expect(isFormFollowUpRecordType("Monitor")).toBe(false);
    expect(isFormFollowUpRecordType("")).toBe(false);
  });
});

describe("an incident's facts", () => {
  const anIncident: (data?: Record<string, unknown>) => unknown = (
    data?: Record<string, unknown>,
  ): unknown => {
    return {
      projectId: PROJECT_ID,
      incidentNumber: 42,
      incidentNumberWithPrefix: "INC-42",
      currentIncidentStateId: STATE_ID,
      currentIncidentState: {
        name: "Investigating",
        color: new Color("#D97706"),
      },
      ...(data || {}),
    };
  };

  test("name its state, its colour and its number as the project shows it", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(anIncident() as never);
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(false as never);

    expect(await readFacts(FormTargetType.Incident)).toEqual({
      state: { name: "Investigating", color: "#d97706", isClosed: false },
      reference: "INC-42",
    });
  });

  test("are closed exactly when the project's rule says its state is resolved", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(anIncident() as never);
    const isResolved: unknown = jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(true as never);

    expect((await readFacts(FormTargetType.Incident))?.state?.isClosed).toBe(
      true,
    );
    expect(isResolved).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentStateId: STATE_ID,
    });
  });

  test("read the record as root, its state's id and no flag of it", async () => {
    const find: unknown = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(anIncident() as never);
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(false as never);

    await readFacts(FormTargetType.Incident);

    const call: FindOneByIdArgs = findCall(find);

    expect(call.id).toBe(RECORD_ID);
    expect(call.props).toEqual({ isRoot: true });
    expect(call.select["currentIncidentStateId"]).toBe(true);
    expect(call.select["currentIncidentState"]).toEqual({
      name: true,
      color: true,
    });
  });

  test("fall back to its bare number, and have no state when it has none", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(
      anIncident({
        incidentNumberWithPrefix: "  ",
        currentIncidentStateId: undefined,
        currentIncidentState: undefined,
      }) as never,
    );
    const isResolved: unknown = jest.spyOn(
      IncidentStateService,
      "isResolvedIncidentState",
    );

    expect(await readFacts(FormTargetType.Incident)).toEqual({
      state: null,
      reference: "#42",
    });
    expect(isResolved).not.toHaveBeenCalled();
  });

  test("are nothing once the incident is gone", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    expect(await readFacts(FormTargetType.Incident)).toBeNull();
  });
});

describe("an alert's facts", () => {
  const anAlert: () => unknown = (): unknown => {
    return {
      projectId: PROJECT_ID,
      alertNumber: 7,
      alertNumberWithPrefix: "ALT-7",
      currentAlertStateId: STATE_ID,
      currentAlertState: { name: "Acknowledged", color: new Color("#2563eb") },
    };
  };

  test("are closed exactly when the project's rule says its state is resolved", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(anAlert() as never);
    const isResolved: unknown = jest
      .spyOn(AlertStateService, "isResolvedAlertState")
      .mockResolvedValue(true as never);

    expect(await readFacts(FormTargetType.Alert)).toEqual({
      state: { name: "Acknowledged", color: "#2563eb", isClosed: true },
      reference: "ALT-7",
    });
    expect(isResolved).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertStateId: STATE_ID,
    });
  });

  test("are open in a state the rule does not resolve", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(anAlert() as never);
    jest
      .spyOn(AlertStateService, "isResolvedAlertState")
      .mockResolvedValue(false as never);

    expect((await readFacts(FormTargetType.Alert))?.state?.isClosed).toBe(
      false,
    );
  });
});

describe("a maintenance event's facts", () => {
  const anEvent: (stateId: ObjectID) => unknown = (
    stateId: ObjectID,
  ): unknown => {
    return {
      projectId: PROJECT_ID,
      scheduledMaintenanceNumber: 3,
      scheduledMaintenanceNumberWithPrefix: "SM-3",
      currentScheduledMaintenanceStateId: stateId,
      currentScheduledMaintenanceState: {
        name: "Reviewing",
        color: new Color("#475569"),
      },
    };
  };

  test("are closed when its state is one the project's events are over in", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(anEvent(STATE_ID) as never);
    const over: unknown = jest
      .spyOn(
        ScheduledMaintenanceStateService,
        "getOverScheduledMaintenanceStateIds",
      )
      .mockResolvedValue([
        OTHER_STATE_ID,
        new ObjectID(STATE_ID.toString()),
      ] as never);

    expect(await readFacts(FormTargetType.ScheduledMaintenance)).toEqual({
      state: { name: "Reviewing", color: "#475569", isClosed: true },
      reference: "SM-3",
    });
    expect(over).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("are open in any other state", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(anEvent(STATE_ID) as never);
    jest
      .spyOn(
        ScheduledMaintenanceStateService,
        "getOverScheduledMaintenanceStateIds",
      )
      .mockResolvedValue([OTHER_STATE_ID] as never);

    expect(
      (await readFacts(FormTargetType.ScheduledMaintenance))?.state?.isClosed,
    ).toBe(false);
  });

  test("read the event as root, its state's id and no flag of it", async () => {
    const find: unknown = jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(anEvent(STATE_ID) as never);
    jest
      .spyOn(
        ScheduledMaintenanceStateService,
        "getOverScheduledMaintenanceStateIds",
      )
      .mockResolvedValue([] as never);

    await readFacts(FormTargetType.ScheduledMaintenance);

    const call: FindOneByIdArgs = findCall(find);

    expect(call.props).toEqual({ isRoot: true });
    expect(call.select["currentScheduledMaintenanceStateId"]).toBe(true);
    expect(call.select["currentScheduledMaintenanceState"]).toEqual({
      name: true,
      color: true,
    });
  });
});

describe("a state's colour", () => {
  test.each([
    ["a colour in capitals, lowered", "#16A34A", "#16a34a"],
    ["no colour", "", undefined],
    ["something that is no colour", "red;background:url(x)", undefined],
    ["a short colour", "#abc", undefined],
  ])(
    "is drawn for %s",
    async (_name: string, stored: string, drawn: string | undefined) => {
      jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
        projectId: PROJECT_ID,
        incidentNumber: 1,
        currentIncidentStateId: STATE_ID,
        currentIncidentState: {
          name: "Open",
          color: stored
            ? {
                toString: (): string => {
                  return stored;
                },
              }
            : undefined,
        },
      } as never);
      jest
        .spyOn(IncidentStateService, "isResolvedIncidentState")
        .mockResolvedValue(false as never);

      expect((await readFacts(FormTargetType.Incident))?.state?.color).toBe(
        drawn,
      );
    },
  );
});
