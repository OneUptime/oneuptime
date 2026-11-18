import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import LabelService from "../../../../Server/Services/LabelService";
import LogService from "../../../../Server/Services/LogService";
import StatusPageAnnouncementService from "../../../../Server/Services/StatusPageAnnouncementService";
import WorkflowVariableService from "../../../../Server/Services/WorkflowVariableService";
import ProductWriteRefusal from "../../../../Server/Utils/ServerProducts/ProductWriteRefusal";
import ServerProductRoutes from "../../../../Server/Utils/ServerProducts/ServerProductRoutes";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../../Server/Utils/Express";
import Log from "../../../../Models/AnalyticsModels/Log";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Label from "../../../../Models/DatabaseModels/Label";
import StatusPageAnnouncement from "../../../../Models/DatabaseModels/StatusPageAnnouncement";
import WorkflowVariable from "../../../../Models/DatabaseModels/WorkflowVariable";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ProductSwitchedOffException from "../../../../Types/Exception/ProductSwitchedOffException";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import ObjectID from "../../../../Types/ObjectID";
import ProductKey from "../../../../Types/Product/ProductKey";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProducts";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * NO WRITE OF A PRODUCT THAT IS OFF GOES THROUGH (#7479).
 *
 * Every create, change and delete a caller makes reaches the database
 * through DatabaseService or AnalyticsDatabaseService with the caller's
 * props, and is refused there - before any hook runs or anything is read -
 * while every product the record serves is switched off on the server: a
 * custom route, a workflow's step and a chat's button cannot write what the
 * CRUD API refuses. The server's own work (root) keeps running, reads are
 * never refused, and a record of no product is never asked about.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c7479000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("c7479000-0000-4000-8000-000000000002");
const RECORD_ID: ObjectID = new ObjectID(
  "c7479000-0000-4000-8000-000000000003",
);

const MEMBER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

// A Project Owner: may write everything in the project, but for a product that is off.
const OWNER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: false,
        } as UserPermission,
      ],
    } as never,
  },
};

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  isMasterAdmin: true,
};

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

let getOff: jest.SpiedFunction<typeof ServerProducts.getOff>;

const switchOff: (products: Array<ProductKey>) => void = (
  products: Array<ProductKey>,
): void => {
  getOff.mockResolvedValue(
    Object.fromEntries(
      products.map((product: ProductKey) => {
        return [product, ServerProductOffReason.SwitchedOff];
      }),
    ),
  );
};

beforeEach(() => {
  getOff = jest.spyOn(ServerProducts, "getOff").mockResolvedValue({});
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProductWriteRefusal", () => {
  test("refuses a member's write of a product that is off, saying who can switch it on", async () => {
    switchOff([ProductKey.StatusPages]);

    const refusal: Promise<void> = ProductWriteRefusal.refuseWhileProductIsOff({
      tableName: "StatusPageSubscriber",
      props: MEMBER,
    });

    await expect(refusal).rejects.toBeInstanceOf(ProductSwitchedOffException);
    await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refusal).rejects.toThrow(
      "Status Pages is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.",
    );
  });

  test("refuses a master admin too: they switch the product on first", async () => {
    switchOff([ProductKey.Workflows]);

    await expect(
      ProductWriteRefusal.refuseWhileProductIsOff({
        tableName: "WorkflowVariable",
        props: MASTER_ADMIN,
      }),
    ).rejects.toBeInstanceOf(ProductSwitchedOffException);
  });

  test("lets the server's own work through without asking", async () => {
    switchOff([ProductKey.StatusPages]);

    await expect(
      ProductWriteRefusal.refuseWhileProductIsOff({
        tableName: "StatusPageSubscriber",
        props: ROOT,
      }),
    ).resolves.toBeUndefined();
    expect(getOff).not.toHaveBeenCalled();
  });

  test("never asks about a record of no product", async () => {
    switchOff([ProductKey.StatusPages, ProductKey.Monitors]);

    for (const tableName of ["Label", "User", "TeamMember", "Probe"]) {
      await expect(
        ProductWriteRefusal.refuseWhileProductIsOff({
          tableName: tableName,
          props: MEMBER,
        }),
      ).resolves.toBeUndefined();
    }

    expect(getOff).not.toHaveBeenCalled();
  });

  test("lets a product that is on through", async () => {
    switchOff([ProductKey.Logs]);

    await expect(
      ProductWriteRefusal.refuseWhileProductIsOff({
        tableName: "StatusPageAnnouncement",
        props: MEMBER,
      }),
    ).resolves.toBeUndefined();
  });

  test("refuses a record two products share only once both are off", async () => {
    switchOff([ProductKey.DataObservability]);

    await expect(
      ProductWriteRefusal.refuseWhileProductIsOff({
        tableName: "DataStore",
        props: MEMBER,
      }),
    ).resolves.toBeUndefined();

    switchOff([ProductKey.DataObservability, ProductKey.DataSecurity]);

    await expect(
      ProductWriteRefusal.refuseWhileProductIsOff({
        tableName: "DataStore",
        props: MEMBER,
      }),
    ).rejects.toThrow("Data Observability is switched off on this server.");
  });

  test("says telemetry ingestion is what to start again, for a telemetry product", async () => {
    getOff.mockResolvedValue({
      [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
    });

    await expect(
      ProductWriteRefusal.refuseWhileProductIsOff({
        tableName: "LogPipeline",
        props: MEMBER,
      }),
    ).rejects.toThrow(
      "Logs is off because telemetry ingestion is stopped on this server.",
    );
  });

  test("refuses nothing without a database to read the products from", async () => {
    switchOff([ProductKey.StatusPages]);
    (
      PostgresAppInstance.isConnected as unknown as jest.Mock
    ).mockReturnValue(false);

    await expect(
      ProductWriteRefusal.refuseWhileProductIsOff({
        tableName: "StatusPageSubscriber",
        props: MEMBER,
      }),
    ).resolves.toBeUndefined();
    expect(getOff).not.toHaveBeenCalled();
  });
});

describe("DatabaseService refuses every caller's write of a product that is off", () => {
  test("a create of a product's other record - a status page's announcement", async () => {
    switchOff([ProductKey.StatusPages]);

    const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
    announcement.projectId = PROJECT_ID;
    announcement.title = "Maintenance tonight";

    await expect(
      StatusPageAnnouncementService.create({
        data: announcement,
        props: MEMBER,
      }),
    ).rejects.toBeInstanceOf(ProductSwitchedOffException);
  });

  test("a change and a delete - a workflow's variable - even by a Project Owner", async () => {
    switchOff([ProductKey.Workflows]);

    await expect(
      WorkflowVariableService.updateOneById({
        id: RECORD_ID,
        data: { name: "renamed" } as never,
        props: OWNER,
      }),
    ).rejects.toThrow("Workflows is switched off on this server.");

    await expect(
      WorkflowVariableService.updateBy({
        query: { projectId: PROJECT_ID },
        data: { name: "renamed" } as never,
        limit: 1,
        skip: 0,
        props: MEMBER,
      }),
    ).rejects.toThrow("Workflows is switched off on this server.");

    await expect(
      WorkflowVariableService.deleteOneById({
        id: RECORD_ID,
        props: OWNER,
      }),
    ).rejects.toThrow("Workflows is switched off on this server.");

    await expect(
      WorkflowVariableService.deleteBy({
        query: { projectId: PROJECT_ID },
        limit: 1,
        skip: 0,
        props: MEMBER,
      }),
    ).rejects.toThrow("Workflows is switched off on this server.");
  });

  test("a create of a record two products share, once both are off", async () => {
    switchOff([ProductKey.DataObservability, ProductKey.DataSecurity]);

    const store: DataStore = new DataStore();
    store.projectId = PROJECT_ID;
    store.name = "warehouse";

    await expect(
      DataStoreService.create({ data: store, props: MEMBER }),
    ).rejects.toBeInstanceOf(ProductSwitchedOffException);
  });

  test("an analytics record, as a log line", async () => {
    switchOff([ProductKey.Logs]);

    const log: Log = new Log();
    log.projectId = PROJECT_ID;

    await expect(
      LogService.create({ data: log, props: MEMBER }),
    ).rejects.toThrow("Logs is switched off on this server.");

    await expect(
      LogService.deleteBy({
        query: { projectId: PROJECT_ID },
        props: MEMBER,
      }),
    ).rejects.toThrow("Logs is switched off on this server.");
  });

  test("a record of no product is not refused for it", async () => {
    switchOff([ProductKey.Monitors, ProductKey.StatusPages]);

    const label: Label = new Label();
    label.projectId = PROJECT_ID;

    /*
     * Refused for something else down the line (nothing here is a real
     * project), never for a product.
     */
    const error: unknown = await LabelService.create({
      data: label,
      props: MEMBER,
    }).catch((err: unknown) => {
      return err;
    });

    expect(error).not.toBeInstanceOf(ProductSwitchedOffException);
    expect(getOff).not.toHaveBeenCalled();
  });

  test("a read is never refused, and never asks", async () => {
    switchOff([ProductKey.Workflows]);

    await WorkflowVariableService.findBy({
      query: { projectId: PROJECT_ID },
      select: { _id: true },
      skip: 0,
      limit: 1,
      props: MEMBER,
    }).catch((err: unknown) => {
      // Nothing here is a real database: only that it did not refuse matters.
      expect(err).not.toBeInstanceOf(ProductSwitchedOffException);
    });

    expect(getOff).not.toHaveBeenCalled();
  });

  test("the server's own write of an off product goes on", async () => {
    switchOff([ProductKey.Workflows]);

    const variable: WorkflowVariable = new WorkflowVariable();
    variable.projectId = PROJECT_ID;

    const error: unknown = await WorkflowVariableService.create({
      data: variable,
      props: ROOT,
    }).catch((err: unknown) => {
      return err;
    });

    expect(error).not.toBeInstanceOf(ProductSwitchedOffException);
    expect(getOff).not.toHaveBeenCalled();
  });
});

describe("ServerProductRoutes", () => {
  const run: (
    product: ProductKey,
  ) => Promise<{ calledWith: Array<unknown> }> = async (
    product: ProductKey,
  ): Promise<{ calledWith: Array<unknown> }> => {
    const calledWith: Array<unknown> = [];

    await ServerProductRoutes.refuseWhileOff(product)(
      {} as ExpressRequest,
      {} as ExpressResponse,
      ((err?: unknown): void => {
        calledWith.push(err);
      }) as NextFunction,
    );

    return { calledWith };
  };

  test("refuses a product's own route while it is off, before its handler", async () => {
    switchOff([ProductKey.StatusPages]);

    const { calledWith } = await run(ProductKey.StatusPages);

    expect(calledWith).toHaveLength(1);
    expect(calledWith[0]).toBeInstanceOf(ProductSwitchedOffException);
    expect((calledWith[0] as Error).message).toBe(
      "Status Pages is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.",
    );
  });

  test("hands on to the handler while it is on", async () => {
    switchOff([ProductKey.Logs]);

    const { calledWith } = await run(ProductKey.StatusPages);

    expect(calledWith).toEqual([undefined]);
  });
});
