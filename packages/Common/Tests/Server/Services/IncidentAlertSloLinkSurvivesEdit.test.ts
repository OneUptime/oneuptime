import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ManyToManySubjectBuilder } from "typeorm/persistence/subject-builder/ManyToManySubjectBuilder";
import { Subject } from "typeorm/persistence/Subject";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Burn rate rules link the SLO that fired to the alert or incident they
 * raise (Alert.serviceLevelObjectives / Incident.serviceLevelObjectives).
 * That link is what lists the record on the SLO's Alerts and Incidents tabs,
 * badges the SLO side menu and names the SLO under Affected Resources.
 *
 * The dashboard shows the link but deliberately never edits it: the Affected
 * Resources edit modal saves monitors, hosts, services and the rest, but not
 * SLOs. So the question is whether saving that modal - or any other partial
 * update - can silently DROP the link. It cannot, and these tests pin the
 * three steps that make it so:
 *
 *   1. ModelForm sends only the fields the form registers, and
 *      BaseModel.toJSONObject leaves undefined columns out of the request
 *      (both are client-side; App/Tests/Dashboard/SloAffectedResourceWiring
 *      pins that no incident or alert form registers the relation).
 *
 *   2. DatabaseService._updateBy writes only the columns the update carries.
 *      A model instance holds `undefined` for every column it did not set
 *      (class fields), and sanitizeUpdateData strips those before the write,
 *      so the entity handed to repository.save() has no
 *      `serviceLevelObjectives` key at all. -> the service tests below.
 *
 *   3. TypeORM's save() rebuilds a many-to-many junction only for a relation
 *      the entity actually carries: ManyToManySubjectBuilder returns early when
 *      the relation value is not an array, while `[]` or `null` clears it.
 *      -> the builder tests at the bottom, which pin the library behaviour
 *      this relies on so a TypeORM upgrade that changed it would fail here
 *      rather than in production.
 *
 * onBeforeUpdate / onUpdateSuccess are stubbed: they validate references and
 * fan out side effects against a live database, and neither decides which
 * columns reach the write.
 */

interface UpdatableService {
  _findBy: (...args: Array<unknown>) => Promise<unknown>;
  onBeforeUpdate: (...args: Array<unknown>) => Promise<unknown>;
  onUpdateSuccess: (...args: Array<unknown>) => Promise<unknown>;
  getRepository: () => unknown;
  updateOneById: (data: {
    id: ObjectID;
    data: unknown;
    props: { isRoot: boolean };
  }) => Promise<number>;
}

interface ServiceCase {
  name: string;
  service: UpdatableService;
  buildFoundRow: (id: ObjectID) => Incident | Alert;
  buildModelInstance: () => Incident | Alert;
  /*
   * What the Affected Resources edit modal submits for this model: every
   * relation its picker edits, and never serviceLevelObjectives.
   */
  editModalPayload: () => Record<string, unknown>;
}

function idStub(): { _id: string } {
  return { _id: ObjectID.generate().toString() };
}

const SERVICE_CASES: Array<ServiceCase> = [
  {
    name: "Incident",
    service: IncidentService as unknown as UpdatableService,
    buildFoundRow: (id: ObjectID): Incident => {
      const incident: Incident = new Incident();
      incident._id = id.toString();
      return incident;
    },
    buildModelInstance: (): Incident => {
      const incident: Incident = new Incident();
      incident.monitors = [new Monitor(ObjectID.generate())];
      incident.hosts = [new Host(ObjectID.generate())];
      return incident;
    },
    editModalPayload: (): Record<string, unknown> => {
      return {
        monitors: [idStub()],
        hosts: [idStub()],
        kubernetesClusters: [],
        dockerHosts: [],
        podmanHosts: [],
        proxmoxClusters: [],
        vmwareVCenters: [],
        cephClusters: [],
        dockerSwarmClusters: [],
        iotFleets: [],
        services: [idStub()],
      };
    },
  },
  {
    name: "Alert",
    service: AlertService as unknown as UpdatableService,
    buildFoundRow: (id: ObjectID): Alert => {
      const alert: Alert = new Alert();
      alert._id = id.toString();
      return alert;
    },
    buildModelInstance: (): Alert => {
      const alert: Alert = new Alert();
      alert.hosts = [new Host(ObjectID.generate())];
      alert.services = [new Service(ObjectID.generate())];
      return alert;
    },
    editModalPayload: (): Record<string, unknown> => {
      return {
        hosts: [idStub()],
        kubernetesClusters: [],
        dockerHosts: [],
        podmanHosts: [],
        proxmoxClusters: [],
        vmwareVCenters: [],
        cephClusters: [],
        dockerSwarmClusters: [],
        iotFleets: [],
        services: [idStub()],
      };
    },
  },
];

describe.each(SERVICE_CASES)(
  "$name update leaves the SLO link alone unless it is written",
  (serviceCase: ServiceCase) => {
    let saveMock: MockFunction;
    let updateMock: MockFunction;
    let rowId: ObjectID;

    beforeEach(() => {
      jest.restoreAllMocks();

      rowId = ObjectID.generate();

      jest
        .spyOn(serviceCase.service, "_findBy")
        .mockResolvedValue([serviceCase.buildFoundRow(rowId)] as never);

      jest.spyOn(serviceCase.service, "onBeforeUpdate").mockImplementation(((
        updateBy: unknown,
      ): Promise<unknown> => {
        return Promise.resolve({ updateBy, carryForward: null });
      }) as never);

      jest.spyOn(serviceCase.service, "onUpdateSuccess").mockImplementation(((
        onUpdate: unknown,
      ): Promise<unknown> => {
        return Promise.resolve(onUpdate);
      }) as never);

      saveMock = getJestMockFunction();
      saveMock.mockImplementation((item: unknown) => {
        return Promise.resolve(item);
      });
      updateMock = getJestMockFunction();
      updateMock.mockImplementation(() => {
        return Promise.resolve({ affected: 1 });
      });

      jest
        .spyOn(serviceCase.service, "getRepository")
        .mockReturnValue({ save: saveMock, update: updateMock } as never);

      jest
        .spyOn(ModelPermission, "checkUpdatePermissionByModel")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(ModelPermission, "checkUpdateQueryPermissions")
        .mockImplementation(((
          _modelType: unknown,
          query: unknown,
        ): Promise<unknown> => {
          return Promise.resolve(query);
        }) as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function update(data: unknown): Promise<number> {
      return serviceCase.service.updateOneById({
        id: rowId,
        data: data,
        props: { isRoot: true },
      });
    }

    function savedEntity(): Record<string, unknown> {
      expect(saveMock).toHaveBeenCalledTimes(1);
      return saveMock.mock.calls[0]![0] as Record<string, unknown>;
    }

    test("saving the Affected Resources edit modal writes its relations and nothing about SLOs", async () => {
      await update(serviceCase.editModalPayload());

      const saved: Record<string, unknown> = savedEntity();

      // The junction write for the edited relations still happens...
      expect(Array.isArray(saved["hosts"])).toBe(true);
      expect(Array.isArray(saved["services"])).toBe(true);
      // ...and the SLO relation is not part of it, so TypeORM leaves it alone.
      expect(
        Object.prototype.hasOwnProperty.call(saved, "serviceLevelObjectives"),
      ).toBe(false);
      expect(updateMock).not.toHaveBeenCalled();
    });

    test("a model instance's unset serviceLevelObjectives field is stripped before the write", async () => {
      const model: Incident | Alert = serviceCase.buildModelInstance();

      /*
       * The trap this guards: every column is an own property of a model
       * instance, initialised to undefined. Were it passed through, the write
       * would carry `serviceLevelObjectives: undefined`.
       */
      expect(
        Object.prototype.hasOwnProperty.call(model, "serviceLevelObjectives"),
      ).toBe(true);
      expect(model.serviceLevelObjectives).toBeUndefined();

      await update(model);

      expect(
        Object.prototype.hasOwnProperty.call(
          savedEntity(),
          "serviceLevelObjectives",
        ),
      ).toBe(false);
    });

    test("a scalar-only edit never reaches save(), so no junction is rebuilt at all", async () => {
      await update({ title: "Renamed" });

      expect(saveMock).not.toHaveBeenCalled();
      expect(updateMock).toHaveBeenCalledTimes(1);

      const setPayload: Record<string, unknown> = updateMock.mock
        .calls[0]![1] as Record<string, unknown>;

      expect(setPayload["serviceLevelObjectives"]).toBeUndefined();
    });

    test("an update that does carry serviceLevelObjectives still writes it (the checks above can fail)", async () => {
      const slo: ServiceLevelObjective = new ServiceLevelObjective(
        ObjectID.generate(),
      );

      await update({ serviceLevelObjectives: [slo] });

      const saved: Record<string, unknown> = savedEntity();

      expect(saved["serviceLevelObjectives"]).toHaveLength(1);
    });
  },
);

/*
 * The TypeORM half. buildForSubjectRelation diffs one many-to-many relation
 * of the entity being saved against what the database holds, and queues
 * junction inserts and removals. The fakes below carry only what that method
 * reads for a relation whose junction has no extra columns.
 */

interface FakeLink {
  _id: string;
}

interface FakeEntity {
  _id: string;
  serviceLevelObjectives?: Array<FakeLink> | null | undefined;
}

interface QueuedJunctionOperation {
  mustBeRemoved: boolean;
  canBeInserted: boolean;
}

type BuildForSubjectRelationFunction = (
  subject: unknown,
  relation: unknown,
) => void;

const LINKED_SLO_A: FakeLink = { _id: "slo-a" };
const LINKED_SLO_B: FakeLink = { _id: "slo-b" };

function junctionOperationsForSave(
  entity: FakeEntity,
): Array<QueuedJunctionOperation> {
  const databaseEntity: FakeEntity = {
    _id: "incident-1",
    serviceLevelObjectives: [LINKED_SLO_A, LINKED_SLO_B],
  };

  const relation: Record<string, unknown> = {
    persistenceEnabled: true,
    isOwning: true,
    getEntityValue: (value: FakeEntity): unknown => {
      return value.serviceLevelObjectives;
    },
    inverseEntityMetadata: {
      getEntityIdMap: (value: FakeLink | undefined): FakeLink | undefined => {
        return value?._id ? { _id: value._id } : undefined;
      },
    },
    junctionEntityMetadata: {
      ownerColumns: [],
      inverseColumns: [],
    },
  };

  const subject: Record<string, unknown> = {
    entity: entity,
    databaseEntity: databaseEntity,
  };
  const subjects: Array<unknown> = [subject];
  const builder: ManyToManySubjectBuilder = new ManyToManySubjectBuilder(
    subjects as unknown as Array<Subject>,
  );

  (
    builder as unknown as {
      buildForSubjectRelation: BuildForSubjectRelationFunction;
    }
  ).buildForSubjectRelation(subject, relation);

  // Everything after the saved entity's own subject is a junction operation.
  return subjects.slice(1).map((queued: unknown): QueuedJunctionOperation => {
    const operation: { mustBeRemoved?: boolean; canBeInserted?: boolean } =
      queued as { mustBeRemoved?: boolean; canBeInserted?: boolean };

    return {
      mustBeRemoved: Boolean(operation.mustBeRemoved),
      canBeInserted: Boolean(operation.canBeInserted),
    };
  });
}

function removals(operations: Array<QueuedJunctionOperation>): number {
  return operations.filter((operation: QueuedJunctionOperation): boolean => {
    return operation.mustBeRemoved;
  }).length;
}

function inserts(operations: Array<QueuedJunctionOperation>): number {
  return operations.filter((operation: QueuedJunctionOperation): boolean => {
    return operation.canBeInserted;
  }).length;
}

describe("TypeORM rebuilds a many-to-many junction only for a relation the saved entity carries", () => {
  test("an entity without the relation key queues nothing, even though two links exist", () => {
    expect(junctionOperationsForSave({ _id: "incident-1" })).toEqual([]);
  });

  test("an explicitly undefined relation queues nothing either", () => {
    expect(
      junctionOperationsForSave({
        _id: "incident-1",
        serviceLevelObjectives: undefined,
      }),
    ).toEqual([]);
  });

  test("an empty array removes every link (so omitting the key really is different)", () => {
    const operations: Array<QueuedJunctionOperation> =
      junctionOperationsForSave({
        _id: "incident-1",
        serviceLevelObjectives: [],
      });

    expect(removals(operations)).toBe(2);
    expect(inserts(operations)).toBe(0);
  });

  test("null is treated as an empty array and removes every link", () => {
    expect(
      removals(
        junctionOperationsForSave({
          _id: "incident-1",
          serviceLevelObjectives: null,
        }),
      ),
    ).toBe(2);
  });

  test("the same links queue nothing", () => {
    expect(
      junctionOperationsForSave({
        _id: "incident-1",
        serviceLevelObjectives: [LINKED_SLO_A, LINKED_SLO_B],
      }),
    ).toEqual([]);
  });

  test("a changed set inserts the new link and removes the dropped ones", () => {
    const operations: Array<QueuedJunctionOperation> =
      junctionOperationsForSave({
        _id: "incident-1",
        serviceLevelObjectives: [LINKED_SLO_A, { _id: "slo-c" }],
      });

    expect(inserts(operations)).toBe(1);
    expect(removals(operations)).toBe(1);
  });
});
