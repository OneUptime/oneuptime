import AlertMeasurement from "../../../Models/DatabaseModels/AlertMeasurement";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import AlertMeasurementService from "../../../Server/Services/AlertMeasurementService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentMeasurementService from "../../../Server/Services/IncidentMeasurementService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What the dashboard's measurement forms send, through each measurement
 * service's hooks - the incident, alert and scheduled maintenance ones, which
 * are line-for-line twins.
 *
 *   - A state picked on the form arrives as the relation
 *     (startIncidentState), not the id column. The services only read the id
 *     column, so a measurement that starts or ends at "a state you pick" was
 *     refused with "Pick the state this measurement starts from", the state
 *     picked right there on the form.
 *   - The edit form sends every column on every save, so a rename restarted
 *     the work-out of every incident's value. Only a changed value does now.
 *   - The unit is the number every chart point is written in, so changing it
 *     works every value out again, in the new unit.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEASUREMENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const FIRST_STATE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MIDDLE_STATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const LAST_STATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

interface MeasurementHooks {
  onBeforeCreate(createBy: CreateBy<BaseModel>): Promise<OnCreate<BaseModel>>;
  onBeforeUpdate(updateBy: UpdateBy<BaseModel>): Promise<OnUpdate<BaseModel>>;
}

interface Spyable {
  findBy: (...args: Array<unknown>) => Promise<unknown>;
  findOneBy: (...args: Array<unknown>) => Promise<unknown>;
}

interface Domain {
  label: string;
  service: unknown;
  stateService: unknown;
  newMeasurement: () => BaseModel;
  newState: () => BaseModel;
  // Where a measurement of this kind usually starts.
  origin: string;
  startStateId: string;
  endStateId: string;
  startState: string;
  endState: string;
  startStateRole: string;
  endStateRole: string;
  // A role the domain's states carry.
  role: string;
}

const DOMAINS: Array<Domain> = [
  {
    label: "Incident measurements",
    service: IncidentMeasurementService,
    stateService: IncidentStateService,
    newMeasurement: (): BaseModel => {
      return new IncidentMeasurement();
    },
    newState: (): BaseModel => {
      return new IncidentState();
    },
    origin: "Declared At",
    startStateId: "startIncidentStateId",
    endStateId: "endIncidentStateId",
    startState: "startIncidentState",
    endState: "endIncidentState",
    startStateRole: "startIncidentStateRole",
    endStateRole: "endIncidentStateRole",
    role: "Resolved",
  },
  {
    label: "Alert measurements",
    service: AlertMeasurementService,
    stateService: AlertStateService,
    newMeasurement: (): BaseModel => {
      return new AlertMeasurement();
    },
    newState: (): BaseModel => {
      return new AlertState();
    },
    origin: "Created At",
    startStateId: "startAlertStateId",
    endStateId: "endAlertStateId",
    startState: "startAlertState",
    endState: "endAlertState",
    startStateRole: "startAlertStateRole",
    endStateRole: "endAlertStateRole",
    role: "Resolved",
  },
  {
    label: "Scheduled maintenance measurements",
    service: ScheduledMaintenanceMeasurementService,
    stateService: ScheduledMaintenanceStateService,
    newMeasurement: (): BaseModel => {
      return new ScheduledMaintenanceMeasurement();
    },
    newState: (): BaseModel => {
      return new ScheduledMaintenanceState();
    },
    origin: "Scheduled Starts At",
    startStateId: "startScheduledMaintenanceStateId",
    endStateId: "endScheduledMaintenanceStateId",
    startState: "startScheduledMaintenanceState",
    endState: "endScheduledMaintenanceState",
    startStateRole: "startScheduledMaintenanceStateRole",
    endStateRole: "endScheduledMaintenanceStateRole",
    role: "Ended",
  },
];

describe.each(DOMAINS)(
  "$label, as the dashboard edits them",
  (domain: Domain) => {
    const hooks: MeasurementHooks = domain.service as MeasurementHooks;
    const service: Spyable = domain.service as Spyable;
    const stateService: Spyable = domain.stateService as Spyable;

    function state(id: ObjectID, name: string, order: number): BaseModel {
      const row: BaseModel = domain.newState();
      row._id = id.toString();
      row.id = id;
      (row as unknown as Record<string, unknown>)["name"] = name;
      (row as unknown as Record<string, unknown>)["order"] = order;
      return row;
    }

    // The project's states, in the order an event moves through them.
    const STATES: Array<BaseModel> = [
      state(FIRST_STATE_ID, "First", 1),
      state(MIDDLE_STATE_ID, "Middle", 2),
      state(LAST_STATE_ID, "Last", 3),
    ];

    // A related row, as ModelForm sends a picked state.
    function picked(id: ObjectID): BaseModel {
      const row: BaseModel = domain.newState();
      row._id = id.toString();
      return row;
    }

    function create(values: Record<string, unknown>): CreateBy<BaseModel> {
      const measurement: BaseModel = domain.newMeasurement();
      Object.assign(measurement, {
        projectId: PROJECT_ID,
        name: "Time in triage",
        key: "time-in-triage",
        ...values,
      });

      return { data: measurement, props: { isRoot: true } };
    }

    // Starts at the first state, ends at the last one: two picked states.
    function stored(values: Record<string, unknown> = {}): BaseModel {
      const measurement: BaseModel = domain.newMeasurement();
      Object.assign(measurement, {
        _id: MEASUREMENT_ID.toString(),
        projectId: PROJECT_ID,
        name: "Time in triage",
        startAnchorType: "State Entered",
        endAnchorType: "State Entered",
        [domain.startStateId]: FIRST_STATE_ID,
        [domain.endStateId]: LAST_STATE_ID,
        [domain.startStateRole]: null,
        [domain.endStateRole]: null,
        startStateOccurrence: "First",
        endStateOccurrence: "First",
        isEnabled: true,
        unit: "seconds",
        ...values,
      });
      return measurement;
    }

    function update(data: Record<string, unknown>): UpdateBy<BaseModel> {
      return {
        id: MEASUREMENT_ID,
        query: { _id: MEASUREMENT_ID.toString() },
        data: data,
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<BaseModel>;
    }

    function restartsHistory(updateBy: UpdateBy<BaseModel>): boolean {
      return (
        (updateBy.data as unknown as Record<string, unknown>)[
          "backfillRequestedAt"
        ] instanceof Date
      );
    }

    beforeEach(() => {
      jest.spyOn(service, "findOneBy").mockResolvedValue(null as never);
      jest.spyOn(service, "findBy").mockResolvedValue([stored()] as never);
      jest.spyOn(stateService, "findBy").mockResolvedValue(STATES as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("a state picked on the form arrives as the relation", () => {
      test("a measurement that starts at a picked state is created", async () => {
        // Nothing else has a key yet.
        jest.spyOn(service, "findBy").mockResolvedValue([] as never);

        await expect(
          hooks.onBeforeCreate(
            create({
              startAnchorType: "State Entered",
              [domain.startState]: picked(MIDDLE_STATE_ID),
              endAnchorType: "State Role Entered",
              [domain.endStateRole]: domain.role,
            }),
          ),
        ).resolves.toBeDefined();
      });

      test("a measurement that ends at a picked state is created", async () => {
        jest.spyOn(service, "findBy").mockResolvedValue([] as never);

        await expect(
          hooks.onBeforeCreate(
            create({
              startAnchorType: domain.origin,
              endAnchorType: "State Entered",
              [domain.endState]: picked(LAST_STATE_ID),
            }),
          ),
        ).resolves.toBeDefined();
      });

      test("two picked states are still checked to come in order", async () => {
        jest.spyOn(service, "findBy").mockResolvedValue([] as never);

        await expect(
          hooks.onBeforeCreate(
            create({
              startAnchorType: "State Entered",
              [domain.startState]: picked(LAST_STATE_ID),
              endAnchorType: "State Entered",
              [domain.endState]: picked(FIRST_STATE_ID),
            }),
          ),
        ).rejects.toThrow(/comes before/);

        await expect(
          hooks.onBeforeCreate(
            create({
              startAnchorType: "State Entered",
              [domain.startState]: picked(FIRST_STATE_ID),
              endAnchorType: "State Entered",
              [domain.endState]: picked(LAST_STATE_ID),
            }),
          ),
        ).resolves.toBeDefined();
      });

      test("an end at a picked state with no state at all is still refused", async () => {
        jest.spyOn(service, "findBy").mockResolvedValue([] as never);

        await expect(
          hooks.onBeforeCreate(
            create({
              startAnchorType: domain.origin,
              endAnchorType: "State Entered",
            }),
          ),
        ).rejects.toThrow(/Pick the state this measurement ends at/);
      });

      test("an edit that picks an end state before the start state is refused", async () => {
        await expect(
          hooks.onBeforeUpdate(
            update({ [domain.endState]: picked(FIRST_STATE_ID) }),
          ),
        ).rejects.toThrow(/always be zero/);

        jest
          .spyOn(service, "findBy")
          .mockResolvedValue([
            stored({ [domain.startStateId]: MIDDLE_STATE_ID }),
          ] as never);

        await expect(
          hooks.onBeforeUpdate(
            update({ [domain.endState]: picked(FIRST_STATE_ID) }),
          ),
        ).rejects.toThrow(/comes before/);
      });
    });

    describe("only a changed value works the history out again", () => {
      test("the edit form's save of a rename, every column as stored, leaves the history alone", async () => {
        const updateBy: UpdateBy<BaseModel> = update({
          name: "Time spent in triage",
          description: "From the first state until the last.",
          startAnchorType: "State Entered",
          endAnchorType: "State Entered",
          [domain.startState]: picked(FIRST_STATE_ID),
          [domain.endState]: picked(LAST_STATE_ID),
          startStateOccurrence: "First",
          endStateOccurrence: "First",
          isEnabled: true,
          unit: "seconds",
          aggregationType: "P90",
        });

        await hooks.onBeforeUpdate(updateBy);

        expect(restartsHistory(updateBy)).toBe(false);
      });

      test("picking another state works the history out again", async () => {
        const updateBy: UpdateBy<BaseModel> = update({
          [domain.endState]: picked(MIDDLE_STATE_ID),
        });

        await hooks.onBeforeUpdate(updateBy);

        expect(restartsHistory(updateBy)).toBe(true);
      });

      test("moving an end to another moment works the history out again", async () => {
        const updateBy: UpdateBy<BaseModel> = update({
          endAnchorType: "State Role Entered",
          [domain.endStateRole]: domain.role,
        });

        await hooks.onBeforeUpdate(updateBy);

        expect(restartsHistory(updateBy)).toBe(true);
      });

      test("changing the unit works the history out again, so every chart point is in the new unit", async () => {
        const updateBy: UpdateBy<BaseModel> = update({ unit: "hours" });

        await hooks.onBeforeUpdate(updateBy);

        expect(restartsHistory(updateBy)).toBe(true);
      });

      test("the unit spelled the same way is no change", async () => {
        const updateBy: UpdateBy<BaseModel> = update({ unit: "seconds" });

        await hooks.onBeforeUpdate(updateBy);

        expect(restartsHistory(updateBy)).toBe(false);
      });
    });
  },
);
