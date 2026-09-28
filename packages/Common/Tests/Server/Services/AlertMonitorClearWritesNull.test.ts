import AlertService from "../../../Server/Services/AlertService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Entities from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { DataSource, EntityMetadata } from "typeorm";
import { Subject } from "typeorm/persistence/Subject";
import { SubjectChangedColumnsComputer } from "typeorm/persistence/SubjectChangedColumnsComputer";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Clearing an alert's monitor in the dashboard has to store NULL, not leave
 * the old monitor in place. The path, end to end:
 *
 *   1. EntityDropdown's Clear selection hands the form null, and ModelForm
 *      submits it: BaseModel.toJSON keeps a null column (it drops only
 *      undefined ones), JSONFunctions.serialize keeps null, and the PUT body
 *      carries `monitor: null` (EventOverviewPages.test.tsx renders that
 *      form and checks the body).
 *   2. BaseAPI.updateItem deserializes the body (null stays null) and hands
 *      it to updateOneById as it is.
 *   3. DatabaseService._updateBy: sanitizeCreateOrUpdate only turns id
 *      strings into relation stubs and leaves null alone. The Affected
 *      Resources payload carries many-to-many lists, so it is written with
 *      repository.save(); a monitor-only payload with repository.update().
 *      -> the service tests below, with the real hooks.
 *   4. TypeORM resolves the `monitor` relation to its join column, monitorId,
 *      and a null relation to an empty parameter - on both paths, since
 *      save() builds its UPDATE from the same value set - and node-postgres
 *      sends an empty parameter as SQL NULL. -> the library tests at the
 *      top, which pin the behaviour so an upgrade that changed it fails here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000001",
);
const ALERT_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000a1";
const OLD_MONITOR_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000b1";
const NEW_MONITOR_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000b2";
const HOST_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000d1";

type PrepareValueFunction = (value: unknown) => unknown;

// The members of the service these tests stub that its type keeps private.
interface HookedAlertService {
  _findBy: (...args: Array<unknown>) => Promise<unknown>;
  onUpdateSuccess: (...args: Array<unknown>) => Promise<unknown>;
}

const hookedAlertService: HookedAlertService =
  AlertService as unknown as HookedAlertService;

describe("TypeORM and node-postgres write a cleared monitor as NULL", () => {
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      entities: Entities,
      synchronize: false,
    });

    await (
      database as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();
  });

  /*
   * The statement repository.update() runs for this SET. Typed loosely: the
   * model's columns are declared without null, which is exactly the value
   * under test.
   */
  function updateStatementFor(set: JSONObject): [string, Array<unknown>] {
    return database
      .createQueryBuilder()
      .update(Alert)
      .set(set as unknown as QueryDeepPartialEntity<Alert>)
      .where({ _id: ALERT_ID })
      .getQueryAndParameters();
  }

  // The parameter the statement binds to "monitorId".
  function monitorIdParameter(statement: [string, Array<unknown>]): unknown {
    const match: RegExpMatchArray | null = statement[0].match(
      /"monitorId" = \$(\d+)/,
    );

    expect(match).not.toBeNull();

    return statement[1][Number(match![1]) - 1];
  }

  test("the monitor relation is the monitorId column", () => {
    const metadata: EntityMetadata = database.getMetadata(Alert);

    expect(
      metadata
        .findColumnsWithPropertyPath("monitor")
        .map((column: { databaseName: string }): string => {
          return column.databaseName;
        }),
    ).toEqual(["monitorId"]);
  });

  test("update() with the relation cleared sets monitorId to an empty parameter", () => {
    expect(monitorIdParameter(updateStatementFor({ monitor: null }))).toBe(
      undefined,
    );
  });

  test("update() with the column cleared sets it to null", () => {
    expect(monitorIdParameter(updateStatementFor({ monitorId: null }))).toBe(
      null,
    );
  });

  test("update() with a relation object sets the monitor's id", () => {
    expect(
      monitorIdParameter(
        updateStatementFor({
          monitor: { _id: NEW_MONITOR_ID },
        }),
      ),
    ).toBe(NEW_MONITOR_ID);
  });

  test("node-postgres sends an empty or null parameter as SQL NULL", () => {
    const prepareValue: PrepareValueFunction = (
      jest.requireActual("pg/lib/utils") as {
        prepareValue: PrepareValueFunction;
      }
    ).prepareValue;

    expect(prepareValue(undefined)).toBeNull();
    expect(prepareValue(null)).toBeNull();
  });

  /*
   * save() diffs the entity against the stored row and builds its UPDATE
   * from the change map. For the monitor that is the same {monitor: null} the
   * update() path writes.
   */
  function changedValuesForSave(entity: JSONObject): JSONObject {
    const subject: Subject = new Subject({
      metadata: database.getMetadata(Alert),
      entity: entity,
      canBeInserted: false,
      canBeUpdated: true,
      mustBeRemoved: false,
    });

    // As SubjectDatabaseEntityLoader loads it: the relation as its id map.
    subject.databaseEntity = {
      _id: ALERT_ID,
      monitorId: OLD_MONITOR_ID,
      monitor: { _id: OLD_MONITOR_ID },
    };
    subject.databaseEntityLoaded = true;

    new SubjectChangedColumnsComputer().compute([subject]);

    return subject.createValueSetAndPopChangeMap() as JSONObject;
  }

  test("save() with the relation cleared writes {monitor: null}, so monitorId = NULL", () => {
    const changed: JSONObject = changedValuesForSave({
      _id: ALERT_ID,
      monitor: null,
      hosts: [],
    });

    expect(changed).toEqual({ monitor: null });
    expect(monitorIdParameter(updateStatementFor(changed))).toBeUndefined();
  });

  test("save() with the monitor it already has writes nothing for it", () => {
    expect(
      changedValuesForSave({
        _id: ALERT_ID,
        monitor: { _id: OLD_MONITOR_ID },
        hosts: [],
      }),
    ).toEqual({});
  });

  test("save() without the monitor key leaves the column alone", () => {
    expect(changedValuesForSave({ _id: ALERT_ID, hosts: [] })).toEqual({});
  });
});

/*
 * The service half: the real AlertService hooks, with the database behind
 * them stubbed (the rows the guard and the write locate, the repository the
 * write goes to), so what reaches TypeORM is exactly what the hooks let
 * through.
 */
describe("AlertService.updateOneById hands TypeORM the cleared monitor", () => {
  let saveMock: MockFunction;
  let updateMock: MockFunction;
  let isCreatedAutomatically: boolean = false;

  // The Workflow "Update Alert" component writes this way; so can the API.
  const ROOT_PROPS: DatabaseCommonInteractionProps = {
    isRoot: true,
    tenantId: PROJECT_ID,
  };

  function storedAlert(): Alert {
    const alert: Alert = new Alert();
    alert._id = ALERT_ID;
    alert.projectId = PROJECT_ID;
    alert.monitorId = new ObjectID(OLD_MONITOR_ID);
    alert.isCreatedAutomatically = isCreatedAutomatically;
    return alert;
  }

  beforeEach(() => {
    isCreatedAutomatically = false;

    // The guard's read of the matched alerts.
    jest.spyOn(AlertService, "findBy").mockImplementation((async (): Promise<
      Array<Alert>
    > => {
      return [storedAlert()];
    }) as never);

    // The rows _updateBy locates for the write.
    jest
      .spyOn(hookedAlertService, "_findBy")
      .mockImplementation((async (): Promise<Array<Alert>> => {
        return [storedAlert()];
      }) as never);

    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "getHeldRelationIds")
      .mockResolvedValue(new Map() as never);
    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
      .mockResolvedValue(undefined as never);

    // Feed, metrics and state changes are covered in AlertMonitorEditFeed.
    jest.spyOn(hookedAlertService, "onUpdateSuccess").mockImplementation(((
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
      .spyOn(AlertService, "getRepository")
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

  function update(data: JSONObject): Promise<number> {
    return AlertService.updateOneById({
      id: new ObjectID(ALERT_ID),
      data: data as never,
      props: ROOT_PROPS,
    });
  }

  test("the Affected Resources modal's payload reaches save() with monitor: null", async () => {
    // As BaseAPI.updateItem hands it over: the deserialized request body.
    await update({
      monitor: null,
      hosts: [{ _id: HOST_ID }],
      services: [],
    });

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();

    const saved: Record<string, unknown> = saveMock.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(Object.prototype.hasOwnProperty.call(saved, "monitor")).toBe(true);
    expect(saved["monitor"]).toBeNull();
    expect(saved["_id"]).toBe(ALERT_ID);
  });

  test("a monitor-only payload reaches update() with monitor: null", async () => {
    await update({ monitor: null });

    expect(saveMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);

    const set: Record<string, unknown> = updateMock.mock.calls[0]![1] as Record<
      string,
      unknown
    >;

    expect(Object.prototype.hasOwnProperty.call(set, "monitor")).toBe(true);
    expect(set["monitor"]).toBeNull();
  });

  test("an API payload clearing monitorId reaches update() with monitorId: null", async () => {
    await update({ monitorId: null });

    const set: Record<string, unknown> = updateMock.mock.calls[0]![1] as Record<
      string,
      unknown
    >;

    expect(set["monitorId"]).toBeNull();
  });

  test("moving the monitor reaches the write as a relation to the new one", async () => {
    await update({ monitor: { _id: NEW_MONITOR_ID } });

    const set: Record<string, unknown> = updateMock.mock.calls[0]![1] as Record<
      string,
      unknown
    >;

    expect((set["monitor"] as { _id: string })._id).toBe(NEW_MONITOR_ID);
  });

  test("for an alert its monitor raised, the clear is refused and nothing is written", async () => {
    isCreatedAutomatically = true;

    await expect(
      update({ monitor: null, hosts: [], services: [] }),
    ).rejects.toThrow(/cannot be changed or removed/);

    expect(saveMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
