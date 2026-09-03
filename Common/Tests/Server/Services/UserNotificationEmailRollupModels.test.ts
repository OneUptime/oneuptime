import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserNotificationEmailRollupBatch from "../../../Models/DatabaseModels/UserNotificationEmailRollupBatch";
import UserNotificationEmailRollupItem from "../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import Services from "../../../Server/Services/Index";
import UserNotificationEmailRollupBatchService from "../../../Server/Services/UserNotificationEmailRollupBatchService";
import UserNotificationEmailRollupItemService from "../../../Server/Services/UserNotificationEmailRollupItemService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  CLAIM_EPOCH_MINUTES,
  FLUSH_AFTER_MINUTES,
  ROLLUP_BATCH_RETENTION_DAYS,
  ROLLUP_ITEM_RETENTION_DAYS,
} from "../../../Server/Utils/EmailRollup/EmailRollupConstants";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import GenericFunction from "../../../Types/GenericFunction";
import ObjectID from "../../../Types/ObjectID";

/*
 * The rollup tables carry almost no behaviour. Everything that makes them
 * safe lives in decorator metadata and in three registration files, and none
 * of it is exercised by a functional test — which is exactly why it is worth
 * pinning here. What breaks in production if any of this regresses:
 *
 *  1. AN OPEN ACCESS LIST IS A NOTIFICATION KILL SWITCH. Both tables are
 *     root-only in every direction. A pending item row is the only record
 *     that a deferred notification is owed to somebody, and a batch row is
 *     what stops a second replica sending the same rollup. Grant create on
 *     the batch table and a caller can pre-claim an epoch so the real flush
 *     is refused; grant delete on the item table and a caller can drop
 *     another member's queued notifications on the floor. Empty lists are
 *     also why the feature needs no new Permission enum members at all — the
 *     assertion below is direct, so PermissionCatalogueCoverage can never be
 *     triggered by these two models in the first place.
 *
 *  2. THE UNIQUE INDEX IS THE EXACTLY-ONCE MECHANISM. Not the Redis
 *     semaphore, and not the "is it still pending?" predicate on the stamping
 *     update — DatabaseService resolves an update predicate in a separate
 *     read, so that is a check-then-act race, not a compare-and-swap. Lose
 *     the four-column UNIQUE index on the batch table, or reorder it, and two
 *     replicas both claim and the flooded recipient gets the rollup twice.
 *
 *  3. rollupBatchId MUST NOT BECOME A FOREIGN KEY. A CASCADE would delete
 *     queue items when their batch is pruned at thirty days, destroying the
 *     volume record; a SET NULL would un-stamp them and hand a month-old
 *     rollup back to the sweep as pending work. Somebody "tidying up" the
 *     model by adding the obvious @ManyToOne is the regression this pins.
 *
 *  4. UNREGISTERED IS INERT. A model missing from AllModelTypes gets no
 *     table; a service missing from the Services array is never swept by the
 *     HardDelete cron, so the queue grows without bound on the exact install
 *     that generates the most rows. Both are silent.
 *
 * Nothing here touches a database: the models are instantiated and read for
 * their decorator metadata, the services are read for their retention
 * settings and their root guards, and the wiring that lives in the App
 * workspace is read off the source as text.
 */

const ITEM_SERVICE_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "../../../Server/Services/UserNotificationEmailRollupItemService.ts",
  ),
  "utf8",
);

const BATCH_SERVICE_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "../../../Server/Services/UserNotificationEmailRollupBatchService.ts",
  ),
  "utf8",
);

/*
 * The routers live in the App workspace, which this suite cannot import, so
 * the mount is asserted by reading the source — the same thing the other
 * wiring tests in this directory do. It breaks on reformatting, which is the
 * price of asserting on the registration itself rather than on a re-export
 * somebody could add to make it pass.
 */
const BASE_API_INDEX_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
  "utf8",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

interface ModelUnderTest {
  name: string;
  modelType: { new (): BaseModel };
  crudApiPath: string;
}

const ROLLUP_MODELS: Array<ModelUnderTest> = [
  {
    name: "UserNotificationEmailRollupItem",
    modelType: UserNotificationEmailRollupItem,
    crudApiPath: "/user-notification-email-rollup-item",
  },
  {
    name: "UserNotificationEmailRollupBatch",
    modelType: UserNotificationEmailRollupBatch,
    crudApiPath: "/user-notification-email-rollup-batch",
  },
];

/*
 * The three root guards are `protected`, which is a compile-time notion only.
 * Calling them through create()/updateBy()/deleteBy() instead would drag the
 * whole ORM in for no extra assurance about the one check under test.
 */
interface RootGuardedServiceInternals {
  onBeforeCreate: (createBy: CreateBy<BaseModel>) => Promise<unknown>;
  onBeforeUpdate: (updateBy: UpdateBy<BaseModel>) => Promise<unknown>;
  onBeforeDelete: (deleteBy: DeleteBy<BaseModel>) => Promise<unknown>;
}

interface RetentionService {
  hardDeleteItemByColumnName: string;
  hardDeleteItemsOlderThanDays: number;
}

interface ServiceUnderTest {
  name: string;
  service: unknown;
  source: string;
  retentionInDays: number;
}

const ROLLUP_SERVICES: Array<ServiceUnderTest> = [
  {
    name: "UserNotificationEmailRollupItemService",
    service: UserNotificationEmailRollupItemService,
    source: ITEM_SERVICE_SOURCE,
    retentionInDays: ROLLUP_ITEM_RETENTION_DAYS,
  },
  {
    name: "UserNotificationEmailRollupBatchService",
    service: UserNotificationEmailRollupBatchService,
    source: BATCH_SERVICE_SOURCE,
    retentionInDays: ROLLUP_BATCH_RETENTION_DAYS,
  },
];

function relationArgs(
  target: GenericFunction,
  propertyName: string,
): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === target && relation.propertyName === propertyName
      );
    },
  );
}

/*
 * A property-level @Index() is stored as a one-column index, so the composite
 * class-level ones are the entries with more than one named column.
 */
function compositeIndexes(target: GenericFunction): Array<IndexMetadataArgs> {
  return getMetadataArgsStorage().indices.filter(
    (index: IndexMetadataArgs): boolean => {
      return (
        index.target === target &&
        Array.isArray(index.columns) &&
        index.columns.length > 1
      );
    },
  );
}

function indexColumns(index: IndexMetadataArgs): Array<string> {
  return index.columns as Array<string>;
}

function findIndexOver(
  target: GenericFunction,
  columns: Array<string>,
): IndexMetadataArgs | undefined {
  return compositeIndexes(target).find((index: IndexMetadataArgs): boolean => {
    return indexColumns(index).join(",") === columns.join(",");
  });
}

function internals(service: unknown): RootGuardedServiceInternals {
  return service as RootGuardedServiceInternals;
}

function retention(service: unknown): RetentionService {
  return service as RetentionService;
}

describe("the rollup tables are tenant-scoped and addressable like every other model", () => {
  test.each(ROLLUP_MODELS)(
    "$name is scoped to a project by projectId",
    (entry: ModelUnderTest) => {
      /*
       * The tenant column is what makes every read, write and permission
       * check project-scoped by default. Without it the flush sweep's own
       * queries would be global in a way nothing downstream expects.
       */
      expect(new entry.modelType().getTenantColumn()).toBe("projectId");
    },
  );

  test.each(ROLLUP_MODELS)(
    "$name is served at its own CRUD path",
    (entry: ModelUnderTest) => {
      expect(new entry.modelType().getCrudApiPath()?.toString()).toBe(
        entry.crudApiPath,
      );
    },
  );

  test.each(ROLLUP_MODELS)(
    "$name is registered in Models/Index.ts",
    (entry: ModelUnderTest) => {
      /*
       * Boot-time createTables() iterates that array. A model missing from it
       * type-checks, imports fine, and simply has no table in Postgres — the
       * write path's fail-open catch would then swallow every insert and the
       * feature would be silently dead.
       */
      expect(AllModelTypes).toContain(entry.modelType);
    },
  );

  test("both services are registered in Services/Index.ts", () => {
    /*
     * Registration is what subscribes a service to the HardDelete cron, which
     * iterates the whole array. Unregistered means the queue is never pruned.
     */
    expect(Services).toContain(UserNotificationEmailRollupItemService);
    expect(Services).toContain(UserNotificationEmailRollupBatchService);
  });

  test("both CRUD routers are mounted in the API", () => {
    expect(BASE_API_INDEX_SOURCE).toContain(
      'import UserNotificationEmailRollupItem from "Common/Models/DatabaseModels/UserNotificationEmailRollupItem";',
    );
    expect(BASE_API_INDEX_SOURCE).toContain(
      'import UserNotificationEmailRollupBatch from "Common/Models/DatabaseModels/UserNotificationEmailRollupBatch";',
    );
    expect(BASE_API_INDEX_SOURCE).toContain(
      "        UserNotificationEmailRollupItem,\n" +
        "        UserNotificationEmailRollupItemServiceType\n" +
        "      >(\n" +
        "        UserNotificationEmailRollupItem,\n" +
        "        UserNotificationEmailRollupItemService,\n" +
        "      ).getRouter(),",
    );
    expect(BASE_API_INDEX_SOURCE).toContain(
      "        UserNotificationEmailRollupBatch,\n" +
        "        UserNotificationEmailRollupBatchServiceType\n" +
        "      >(\n" +
        "        UserNotificationEmailRollupBatch,\n" +
        "        UserNotificationEmailRollupBatchService,\n" +
        "      ).getRouter(),",
    );
  });
});

describe("both tables are root-only, which is why the feature needs no new permissions", () => {
  test.each(ROLLUP_MODELS)(
    "$name refuses create, read, update and delete to every permission",
    (entry: ModelUnderTest) => {
      const model: BaseModel = new entry.modelType();

      expect(model.createRecordPermissions).toEqual([]);
      expect(model.readRecordPermissions).toEqual([]);
      expect(model.updateRecordPermissions).toEqual([]);
      expect(model.deleteRecordPermissions).toEqual([]);
    },
  );

  /*
   * THE INVARIANT THIS BLOCK EXISTS FOR. Not one column may name a Permission
   * member. That is both the security property — nothing about a mail ledger
   * is a user-facing resource — and the reason PermissionCatalogueCoverage
   * has nothing to sweep here: a permission these models referenced but the
   * catalogue did not describe would gate the table and be ungrantable, and
   * the only way to be sure of never hitting that is to reference none.
   */
  test.each(ROLLUP_MODELS)(
    "$name names no permission on any column, not even a readable one",
    (entry: ModelUnderTest) => {
      const model: BaseModel = new entry.modelType();
      const allColumns: Dictionary<ColumnAccessControl> =
        model.getColumnAccessControlForAllColumns();
      const columnNames: Array<string> = Object.keys(allColumns);

      // Guards the loop below against passing on an empty dictionary.
      expect(columnNames.length).toBeGreaterThan(10);

      for (const columnName of columnNames) {
        const accessControl: ColumnAccessControl = allColumns[
          columnName
        ] as ColumnAccessControl;

        expect(accessControl.create).toEqual([]);
        expect(accessControl.read).toEqual([]);
        expect(accessControl.update).toEqual([]);
      }
    },
  );
});

describe("deleting a project or a user takes its rollup rows with it", () => {
  test.each(ROLLUP_MODELS)(
    "$name cascades from both project and user",
    (entry: ModelUnderTest) => {
      /*
       * CASCADE rather than SET NULL on both: a queue row whose project or
       * recipient has been deleted is not a row to keep and re-send, and both
       * id columns are NOT NULL, so SET NULL would fail the delete outright.
       */
      const project: RelationMetadataArgs | undefined = relationArgs(
        entry.modelType,
        "project",
      );
      const user: RelationMetadataArgs | undefined = relationArgs(
        entry.modelType,
        "user",
      );

      expect(project?.relationType).toBe("many-to-one");
      expect(project?.options.onDelete).toBe("CASCADE");
      expect(user?.relationType).toBe("many-to-one");
      expect(user?.options.onDelete).toBe("CASCADE");
    },
  );

  /*
   * ...and rollupBatchId is the deliberate exception: a bare ObjectID column
   * with no relation and therefore no foreign key. Adding the obvious
   * @ManyToOne would give it a referential action, and both available actions
   * are wrong — CASCADE deletes seven-day queue rows when their thirty-day
   * batch is pruned, SET NULL un-stamps them and re-sends a month-old rollup.
   */
  test("rollupBatchId carries no relation, so no foreign key can be generated", () => {
    expect(
      relationArgs(UserNotificationEmailRollupItem, "rollupBatchId"),
    ).toBeUndefined();
    expect(
      relationArgs(UserNotificationEmailRollupItem, "rollupBatch"),
    ).toBeUndefined();

    const relationsOnItem: Array<string> = getMetadataArgsStorage()
      .relations.filter((relation: RelationMetadataArgs): boolean => {
        return relation.target === UserNotificationEmailRollupItem;
      })
      .map((relation: RelationMetadataArgs): string => {
        return relation.propertyName;
      });

    expect(relationsOnItem.sort()).toEqual(["project", "user"]);
  });
});

describe("the indexes each table cannot work without", () => {
  /*
   * THE EXACTLY-ONCE MECHANISM. Four columns, in this order, UNIQUE. The
   * order matters as much as the membership: claimEpochStartsAt has to be
   * last so the leading three columns are the bucket key a lookup can also
   * use, and the epoch is what turns "this address, now" into a value two
   * replicas compute identically and therefore collide on.
   */
  test("the batch table claims under a UNIQUE index over exactly the bucket key plus the epoch", () => {
    const claimIndex: IndexMetadataArgs | undefined = findIndexOver(
      UserNotificationEmailRollupBatch,
      ["projectId", "userId", "toEmail", "claimEpochStartsAt"],
    );

    expect(claimIndex).toBeDefined();
    expect(claimIndex?.unique).toBe(true);
    expect(indexColumns(claimIndex as IndexMetadataArgs)).toEqual([
      "projectId",
      "userId",
      "toEmail",
      "claimEpochStartsAt",
    ]);
  });

  test("the item table declares all three of its composite indexes", () => {
    /*
     * The burst counter runs on the hot notification path and counts over the
     * leading four columns with a createdAt range, so all five are in one
     * index or the count is a scan of the tenant's whole queue.
     */
    expect(
      findIndexOver(UserNotificationEmailRollupItem, [
        "projectId",
        "userId",
        "toEmail",
        "rollupCategory",
        "createdAt",
      ]),
    ).toBeDefined();

    /*
     * The sweep's index: pending, oldest first, across every tenant. It is
     * global by design and so cannot be scoped by projectId.
     */
    expect(
      findIndexOver(UserNotificationEmailRollupItem, ["sentAt", "createdAt"]),
    ).toBeDefined();

    /*
     * The read-back index. A flush stamps its claimed rows and then re-reads
     * them by batch, so it renders exactly the rows it wrote.
     */
    const byBatch: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === UserNotificationEmailRollupItem &&
            Array.isArray(index.columns) &&
            index.columns.join(",") === "rollupBatchId"
          );
        },
      );

    expect(byBatch).toBeDefined();
  });

  test("none of the item table's indexes is unique", () => {
    /*
     * The item table is an append-only ledger — the same address legitimately
     * receives two notifications of the same type in the same second. A
     * unique index anywhere on it would make the write path's fail-open catch
     * swallow the second one.
     */
    for (const index of compositeIndexes(UserNotificationEmailRollupItem)) {
      expect(index.unique).toBe(false);
    }
  });
});

describe("retention is registered unconditionally, on both services", () => {
  test.each(ROLLUP_SERVICES)(
    "$name prunes on createdAt",
    (entry: ServiceUnderTest) => {
      expect(retention(entry.service).hardDeleteItemByColumnName).toBe(
        "createdAt",
      );
      expect(retention(entry.service).hardDeleteItemsOlderThanDays).toBe(
        entry.retentionInDays,
      );
    },
  );

  test("the two retentions are seven days and thirty days", () => {
    expect(ROLLUP_ITEM_RETENTION_DAYS).toBe(7);
    expect(ROLLUP_BATCH_RETENTION_DAYS).toBe(30);
  });

  /*
   * EmailLogService registers its retention only `if (IsBillingEnabled)`, and
   * copying that here would be a real bug rather than a style choice: the
   * HardDelete:HardDeleteOlderItemsInDatabase cron iterates every service in
   * the Services array and honours whatever retention it declares, with no
   * billing check anywhere in the loop. A gated call therefore prunes nothing
   * at all on a self-hosted install — which is precisely the install that
   * generates the most rows, because it is the one being flooded.
   */
  test.each(ROLLUP_SERVICES)(
    "$name does not gate its retention on billing",
    (entry: ServiceUnderTest) => {
      const constructorBody: string = entry.source.slice(
        entry.source.indexOf("public constructor()"),
        entry.source.indexOf("@CaptureSpan()"),
      );

      expect(constructorBody).toContain("hardDeleteItemsOlderThanInDays(");
      expect(constructorBody).toContain('"createdAt"');
      /*
       * No branch of any kind, and no billing flag, between super(Model) and
       * the retention call. The import check is the stronger half: the flag
       * lives in EnvironmentConfig and cannot be reached without importing
       * it, whereas the whole-file text mentions IsBillingEnabled in the
       * comment that explains why it is deliberately absent.
       */
      expect(constructorBody).not.toContain("if (");
      expect(constructorBody).not.toContain("IsBillingEnabled");
      expect(entry.source).not.toContain("EnvironmentConfig");
    },
  );
});

describe("nothing but the notification pipeline may write to either table", () => {
  const NON_ROOT: { isRoot: boolean; tenantId: ObjectID } = {
    isRoot: false,
    tenantId: PROJECT_ID,
  };

  test.each(ROLLUP_SERVICES)(
    "$name refuses a non-root create",
    async (entry: ServiceUnderTest) => {
      const item: UserNotificationEmailRollupItem =
        new UserNotificationEmailRollupItem();
      item.projectId = PROJECT_ID;
      item.userId = USER_ID;

      await expect(
        internals(entry.service).onBeforeCreate({
          data: item,
          props: NON_ROOT,
        } as unknown as CreateBy<BaseModel>),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test.each(ROLLUP_SERVICES)(
    "$name refuses a non-root update",
    async (entry: ServiceUnderTest) => {
      await expect(
        internals(entry.service).onBeforeUpdate({
          query: {},
          data: {},
          props: NON_ROOT,
        } as unknown as UpdateBy<BaseModel>),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test.each(ROLLUP_SERVICES)(
    "$name refuses a non-root delete",
    async (entry: ServiceUnderTest) => {
      await expect(
        internals(entry.service).onBeforeDelete({
          query: {},
          props: NON_ROOT,
        } as unknown as DeleteBy<BaseModel>),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );
});

/*
 * The claim epoch and the flush delay are two constants that look independent
 * and are not. A bucket becomes due only once its oldest pending item is
 * FLUSH_AFTER_MINUTES old, and a flush stamps every pending row for that
 * bucket, so a legitimate consecutive flush is always at least that long
 * after the previous one. Only while the epoch is the same length does that
 * guarantee "always a later epoch", and therefore "the UNIQUE index never
 * refuses real work". Shorten the epoch and duplicate rollups become
 * possible; lengthen it and a legitimate second flush is silently dropped.
 */
test("the claim epoch is exactly as long as the flush delay", () => {
  expect(CLAIM_EPOCH_MINUTES).toBe(FLUSH_AFTER_MINUTES);
});
