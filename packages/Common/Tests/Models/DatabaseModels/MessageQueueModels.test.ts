import AllModelTypes, {
  getModelTypeByName,
} from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import MessageQueue, {
  MESSAGE_QUEUE_DISCOVERY_SOURCES,
  getMessageQueueDiscoverySourceLabel,
} from "../../../Models/DatabaseModels/MessageQueue";
import MessageQueueLabelRule from "../../../Models/DatabaseModels/MessageQueueLabelRule";
import MessageQueueOwnerRule from "../../../Models/DatabaseModels/MessageQueueOwnerRule";
import MessageQueueOwnerTeam from "../../../Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerUser from "../../../Models/DatabaseModels/MessageQueueOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getUniqueColumnsBy } from "../../../Types/Database/UniqueColumnBy";
import { UniqueColumnsTogetherMetadata } from "../../../Types/Database/UniqueColumnsTogether";
import BadDataException from "../../../Types/Exception/BadDataException";
import IconProp from "../../../Types/Icon/IconProp";
import {
  MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH,
  MESSAGE_QUEUE_IDENTIFIER_MAX_LENGTH,
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  parseMessageQueueIdentifier,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import { MESSAGE_QUEUE_DESTINATION_MAX_LENGTH } from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "../../../Types/MessageQueue/MessagingSystem";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { JoinColumnMetadataArgs } from "typeorm/metadata-args/JoinColumnMetadataArgs";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import fs from "fs";
import path from "path";

/*
 * The Queues product is persisted as five TypeORM entities: the MessageQueue
 * root and the owner / rule models cloned from the Databases product.
 *
 * What is pinned here only fails in production:
 *
 *   - registration in Models/Index.ts (no table, no API otherwise)
 *   - the table / route / display names other layers key on, and staying
 *     clear of the BullMQ `Queue` the workers already import
 *   - the identity index discovery relies on for race safety, and the two
 *     NAMED partial unique indexes a generated migration would otherwise
 *     drop
 *   - the column ACL contract: DatabaseService.create runs onBeforeCreate
 *     BEFORE the column permission check, so every column the service sets on
 *     a manual create must be user-creatable, and every column only discovery
 *     writes must be closed to users - checked here against the real
 *     ColumnPermission / CreatePermission code, not just the declarations
 *   - the rule criteria fields and the permissions
 *   - Postgres's 63-character identifier limit
 *
 * Pure metadata and in-process permission checks - no Postgres connection.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

interface QueueModelSpec {
  name: string;
  modelType: ModelType;
  tableName: string;
  crudApiPath: string;
  singularName: string;
  pluralName: string;
  icon: IconProp;
}

const QUEUE_MODELS: Array<QueueModelSpec> = [
  {
    name: "MessageQueue",
    modelType: MessageQueue,
    tableName: "MessageQueue",
    crudApiPath: "/message-queue",
    singularName: "Queue",
    pluralName: "Queues",
    icon: IconProp.QueueList,
  },
  {
    name: "MessageQueueOwnerTeam",
    modelType: MessageQueueOwnerTeam,
    tableName: "MessageQueueOwnerTeam",
    crudApiPath: "/message-queue-owner-team",
    singularName: "Queue Team Owner",
    pluralName: "Queue Team Owners",
    icon: IconProp.Cube,
  },
  {
    name: "MessageQueueOwnerUser",
    modelType: MessageQueueOwnerUser,
    tableName: "MessageQueueOwnerUser",
    crudApiPath: "/message-queue-owner-user",
    singularName: "Queue User Owner",
    pluralName: "Queue User Owners",
    icon: IconProp.Cube,
  },
  {
    name: "MessageQueueLabelRule",
    modelType: MessageQueueLabelRule,
    tableName: "MessageQueueLabelRule",
    crudApiPath: "/message-queue-label-rule",
    singularName: "Queue Label Rule",
    pluralName: "Queue Label Rules",
    icon: IconProp.Tag,
  },
  {
    name: "MessageQueueOwnerRule",
    modelType: MessageQueueOwnerRule,
    tableName: "MessageQueueOwnerRule",
    crudApiPath: "/message-queue-owner-rule",
    singularName: "Queue Owner Rule",
    pluralName: "Queue Owner Rules",
    // Every infrastructure owner rule (Ceph, VMware, Cloud, Databases) uses User.
    icon: IconProp.User,
  },
];

// Every child of MessageQueue and the relation property it reaches it by.
const MESSAGE_QUEUE_CHILDREN: Array<[ModelType, string]> = [
  [MessageQueueOwnerTeam, "messageQueue"],
  [MessageQueueOwnerUser, "messageQueue"],
];

const MESSAGE_QUEUE_PERMISSIONS: Array<string> = [
  "CreateMessageQueue",
  "DeleteMessageQueue",
  "EditMessageQueue",
  "ReadMessageQueue",
  "CreateMessageQueueOwnerTeam",
  "DeleteMessageQueueOwnerTeam",
  "EditMessageQueueOwnerTeam",
  "ReadMessageQueueOwnerTeam",
  "CreateMessageQueueOwnerUser",
  "DeleteMessageQueueOwnerUser",
  "EditMessageQueueOwnerUser",
  "ReadMessageQueueOwnerUser",
  "CreateMessageQueueLabelRule",
  "DeleteMessageQueueLabelRule",
  "EditMessageQueueLabelRule",
  "ReadMessageQueueLabelRule",
  "CreateMessageQueueOwnerRule",
  "DeleteMessageQueueOwnerRule",
  "EditMessageQueueOwnerRule",
  "ReadMessageQueueOwnerRule",
];

// The rule criteria fields the registry, the engines and the forms share.
const RULE_CRITERIA_FIELDS: Array<string> = [
  "messageQueueLabels",
  "messageQueueNamePattern",
  "messageQueueDescriptionPattern",
  "messageQueueSystemPattern",
];

/*
 * Every column MessageQueueService.onBeforeCreate may set on a manual
 * (non-root) create, plus what DatabaseService itself stamps (projectId,
 * createdByUserId) and what the create form may send.
 */
const MESSAGE_QUEUE_USER_CREATE_COLUMNS: Array<string> = [
  "project",
  "projectId",
  "name",
  "description",
  "queueIdentifier",
  "messagingSystem",
  "destinationName",
  "brokerScope",
  "discoverySource",
  "labels",
  "isArchived",
  "createdByUser",
  "createdByUserId",
];

// Columns a person may change after creation.
const MESSAGE_QUEUE_USER_UPDATE_COLUMNS: Array<string> = [
  "name",
  "description",
  "labels",
  "isArchived",
];

// Columns only discovery, the sighting heartbeat and the archive paths write, as root.
const MESSAGE_QUEUE_ROOT_ONLY_COLUMNS: Array<string> = [
  "slug",
  "brokerAddress",
  "lastSeenAt",
  "brokerMetricsLastSeenAt",
  "autoArchivedAt",
  "manuallyRestoredAt",
  "automaticAssignments",
  "archivedAt",
  "archivedByUser",
  "archivedByUserId",
  "deletedByUser",
  "deletedByUserId",
];

const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

const PERMISSION_PROPS_BY_NAME: Map<string, PermissionProps> = new Map(
  PERMISSION_PROPS.map((props: PermissionProps) => {
    return [props.permission.toString(), props];
  }),
);

const PROJECT_ID: ObjectID = new ObjectID(
  "9e1b6b0e-0000-4000-8000-00000000c7a1",
);
const USER_ID: ObjectID = new ObjectID("9e1b6b0e-0000-4000-8000-00000000c7a2");

/*
 * DatabaseCommonInteractionPropsUtil.getUserPermissions only reads the tenant
 * bucket when props.tenantId is set, and drops every permission whose
 * isBlockPermission does not match. Getting either wrong yields an empty
 * permission set, which would make every "does not throw" below pass for the
 * wrong reason - hence the harness guard test further down.
 */
function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

// What a manual create posts after MessageQueueService.onBeforeCreate ran.
function manualCreateData(): MessageQueue {
  const data: MessageQueue = new MessageQueue();
  data.projectId = PROJECT_ID;
  data.name = "orders";
  data.description = "Orders from checkout to fulfilment";
  data.messagingSystem = "servicebus";
  data.destinationName = "orders";
  data.brokerScope = "orders-prod";
  data.queueIdentifier = "servicebus|orders-prod|orders";
  data.discoverySource = "manual";
  data.createdByUserId = USER_ID;
  return data;
}

type CheckFunction = () => void;

function checkCreate(
  modelType: ModelType,
  data: BaseModel,
  permissions: Array<Permission>,
): CheckFunction {
  return () => {
    ModelPermission.checkCreatePermissions(
      modelType,
      data,
      makeProps(permissions),
    );
  };
}

function checkColumns(
  modelType: ModelType,
  data: BaseModel,
  permissions: Array<Permission>,
  requestType: DatabaseRequestType,
): CheckFunction {
  return () => {
    ColumnPermissions.checkDataColumnPermissions(
      modelType,
      data,
      makeProps(permissions),
      requestType,
    );
  };
}

function allReferencedPermissions(model: BaseModel): Array<Permission> {
  const permissions: Array<Permission> = [
    ...(model.createRecordPermissions || []),
    ...(model.readRecordPermissions || []),
    ...(model.updateRecordPermissions || []),
    ...(model.deleteRecordPermissions || []),
  ];

  for (const column of model.getTableColumns().columns) {
    const accessControl: ColumnAccessControl | undefined =
      model.getColumnAccessControlFor(column) || undefined;

    if (!accessControl) {
      continue;
    }

    permissions.push(
      ...(accessControl.create || []),
      ...(accessControl.read || []),
      ...(accessControl.update || []),
    );
  }

  return permissions;
}

/*
 * DatabaseBaseModel's own columns (_id, timestamps, version). They carry the
 * table ACL by default (or none, for version) and are never written through
 * the column check, so the per-column sweeps below skip them.
 */
const BASE_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

function ownColumns(model: BaseModel): Array<string> {
  return model.getTableColumns().columns.filter((column: string): boolean => {
    return !BASE_COLUMNS.includes(column);
  });
}

function columnAccess(model: BaseModel, column: string): ColumnAccessControl {
  const accessControl: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  if (!accessControl) {
    throw new Error(`${column} has no @ColumnAccessControl`);
  }

  return accessControl;
}

function columnArgs(
  modelType: ModelType,
  property: string,
): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined = (
    getMetadataArgsStorage().columns as Array<ColumnMetadataArgs>
  ).find((candidate: ColumnMetadataArgs) => {
    return (
      candidate.target === modelType && candidate.propertyName === property
    );
  });

  if (!column) {
    throw new Error(`${modelType.name}.${property} is not a registered column`);
  }

  return column;
}

function relationArgs(
  modelType: ModelType,
  property: string,
): RelationMetadataArgs {
  const relation: RelationMetadataArgs | undefined = (
    getMetadataArgsStorage().relations as Array<RelationMetadataArgs>
  ).find((candidate: RelationMetadataArgs) => {
    return (
      candidate.target === modelType && candidate.propertyName === property
    );
  });

  if (!relation) {
    throw new Error(
      `${modelType.name}.${property} is not a registered relation`,
    );
  }

  return relation;
}

function joinColumnArgs(
  modelType: ModelType,
  property: string,
): JoinColumnMetadataArgs {
  const joinColumn: JoinColumnMetadataArgs | undefined = (
    getMetadataArgsStorage().joinColumns as Array<JoinColumnMetadataArgs>
  ).find((candidate: JoinColumnMetadataArgs) => {
    return (
      candidate.target === modelType && candidate.propertyName === property
    );
  });

  if (!joinColumn) {
    throw new Error(`${modelType.name}.${property} has no @JoinColumn`);
  }

  return joinColumn;
}

function joinTableArgs(
  modelType: ModelType,
  property: string,
): JoinTableMetadataArgs {
  const joinTable: JoinTableMetadataArgs | undefined = (
    getMetadataArgsStorage().joinTables as Array<JoinTableMetadataArgs>
  ).find((candidate: JoinTableMetadataArgs) => {
    return (
      candidate.target === modelType && candidate.propertyName === property
    );
  });

  if (!joinTable) {
    throw new Error(`${modelType.name}.${property} has no @JoinTable`);
  }

  return joinTable;
}

function classIndexes(modelType: ModelType): Array<IndexMetadataArgs> {
  return getMetadataArgsStorage().indices.filter(
    (index: IndexMetadataArgs): boolean => {
      return index.target === modelType;
    },
  );
}

function indexOnColumns(
  modelType: ModelType,
  columns: Array<string>,
): IndexMetadataArgs | undefined {
  return classIndexes(modelType).find((index: IndexMetadataArgs): boolean => {
    return (
      Array.isArray(index.columns) &&
      index.columns.length === columns.length &&
      columns.every((column: string): boolean => {
        return (index.columns as Array<string>).includes(column);
      })
    );
  });
}

function propertyIndex(
  modelType: ModelType,
  property: string,
): IndexMetadataArgs | undefined {
  // A property-level @Index() is recorded with [propertyName] as its columns.
  return classIndexes(modelType).find((index: IndexMetadataArgs): boolean => {
    return (
      Array.isArray(index.columns) &&
      index.columns.length === 1 &&
      index.columns[0] === property &&
      !index.name
    );
  });
}

function namedIndex(
  modelType: ModelType,
  name: string,
): IndexMetadataArgs | undefined {
  return classIndexes(modelType).find((index: IndexMetadataArgs): boolean => {
    return index.name === name;
  });
}

function modelSource(modelName: string): string {
  return fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Models",
      "DatabaseModels",
      `${modelName}.ts`,
    ),
    "utf8",
  );
}

/*
 * The source with its comments removed. Comments may name the template a
 * model was cloned from ("like DatabaseServer.databaseIdentifier"); code may
 * not. A line comment must start a line or follow whitespace, so the "//" of
 * a URL inside a string is left alone.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

function sorted(values: Array<Permission | string>): Array<string> {
  return values
    .map((value: Permission | string): string => {
      return value.toString();
    })
    .sort();
}

describe("Queues (MessageQueue) models", () => {
  test("the inventory is complete", () => {
    expect(QUEUE_MODELS.length).toBe(5);
    expect(MESSAGE_QUEUE_PERMISSIONS.length).toBe(20);
  });

  describe("harness guard", () => {
    /*
     * Runs first on purpose. Most permission assertions below are "does not
     * throw", which a props object the permission util silently ignored
     * would also satisfy. A caller holding only a READ grant must be refused
     * a create; if it is not, makeProps is broken, not the model.
     */
    test("a read-only caller is refused a manual create", () => {
      expect(
        checkCreate(MessageQueue, manualCreateData(), [
          Permission.ReadMessageQueue,
        ]),
      ).toThrow();
    });

    test("a caller with no permissions at all is refused a column write", () => {
      expect(
        checkColumns(
          MessageQueue,
          manualCreateData(),
          [],
          DatabaseRequestType.Create,
        ),
      ).toThrow(BadDataException);
    });
  });

  describe("registration and identity", () => {
    test.each(QUEUE_MODELS)(
      "$name is registered in Models/Index.ts",
      (spec: QueueModelSpec) => {
        /*
         * Boot-time createTables() and the migration generator both iterate
         * that array. A model missing from it type-checks, imports fine, and
         * simply has no table in Postgres.
         */
        expect(MODEL_TYPES).toContain(spec.modelType);
        expect(
          MODEL_TYPES.filter((modelType: ModelType): boolean => {
            return modelType === spec.modelType;
          }),
        ).toHaveLength(1);
      },
    );

    test.each(QUEUE_MODELS)(
      "$name resolves by its table name through getModelTypeByName",
      (spec: QueueModelSpec) => {
        // The generic API / workflow layers look models up by table name.
        expect(getModelTypeByName(spec.tableName)).toBe(spec.modelType);
      },
    );

    test.each(QUEUE_MODELS)(
      "$name carries its own table, route, display names and icon",
      (spec: QueueModelSpec) => {
        const model: BaseModel = new spec.modelType();

        expect(spec.modelType.name).toBe(spec.name);
        expect(model.tableName).toBe(spec.tableName);
        expect(model.getCrudApiPath()?.toString()).toBe(spec.crudApiPath);
        expect(model.singularName).toBe(spec.singularName);
        expect(model.pluralName).toBe(spec.pluralName);
        expect(model.icon).toBe(spec.icon);
        expect(model.getTenantColumn()).toBe("projectId");
        expect(model.enableDocumentation).toBe(true);
        expect((model.tableDescription || "").length).toBeGreaterThan(20);
      },
    );

    test("no Queues route or table name collides with another model", () => {
      const routes: Map<string, number> = new Map<string, number>();
      const tables: Map<string, number> = new Map<string, number>();

      for (const modelType of MODEL_TYPES) {
        const model: BaseModel = new modelType();
        const route: string | undefined = model.getCrudApiPath()?.toString();

        if (route) {
          routes.set(route, (routes.get(route) || 0) + 1);
        }

        if (model.tableName) {
          tables.set(model.tableName, (tables.get(model.tableName) || 0) + 1);
        }
      }

      for (const spec of QUEUE_MODELS) {
        expect(routes.get(spec.crudApiPath)).toBe(1);
        expect(tables.get(spec.tableName)).toBe(1);
      }
    });

    test("does not take the name the BullMQ job queue already uses", () => {
      /*
       * Server/Infrastructure/Queue.ts default-exports `Queue` (BullMQ) and
       * every worker imports it. No model may claim the bare name, and every
       * Queues route lives under /message-queue.
       */
      expect(getModelTypeByName("Queue")).toBeNull();

      for (const spec of QUEUE_MODELS) {
        expect(spec.tableName).not.toBe("Queue");
        expect(spec.crudApiPath.startsWith("/message-queue")).toBe(true);
      }
    });

    test.each(QUEUE_MODELS)(
      "$name source carries no Databases leftovers",
      (spec: QueueModelSpec) => {
        /*
         * The models were cloned from the Databases product. A leftover
         * `/database-server` route or `databaseServerId` column reads fine in
         * review and silently binds the wrong table. Comments are exempt:
         * pointing at the template a decision was copied from is
         * documentation, not a binding.
         */
        const source: string = codeOf(modelSource(spec.name));

        // Guards the stripping itself: the class must still be in there.
        expect(source).toContain(`export default class ${spec.name}`);

        for (const token of [
          "DatabaseServer",
          "databaseServer",
          "database-server",
          "dbSystem",
          "databases",
          "Ceph",
          "ceph",
        ]) {
          expect({ token, found: source.includes(token) }).toEqual({
            token,
            found: false,
          });
        }
      },
    );
  });

  describe("MessageQueue", () => {
    const model: MessageQueue = new MessageQueue();

    test("is unique per project on queueIdentifier - named, partial, the discovery join key", () => {
      /*
       * Discovery find-or-creates by queueIdentifier, and worker runs race on
       * the same queue; only a DB-level unique index collapses them into one
       * row. Partial (live rows only) and declared by name, so the drift
       * check keeps it.
       */
      const found: IndexMetadataArgs | undefined = namedIndex(
        MessageQueue,
        "IDX_message_queue_identifier",
      );

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.columns).toEqual(["projectId", "queueIdentifier"]);
      expect(found?.where).toBe('"deletedAt" IS NULL');
    });

    test("the display name is NOT unique - two brokers may each have an 'orders'", () => {
      const nameIndexes: Array<IndexMetadataArgs> = classIndexes(
        MessageQueue,
      ).filter((index: IndexMetadataArgs): boolean => {
        return (
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).includes("name")
        );
      });

      expect(nameIndexes.length).toBeGreaterThan(0);

      for (const index of nameIndexes) {
        expect(index.unique).not.toBe(true);
      }

      // Nor the app-level @UniqueColumnBy check ServerlessFunction.name carries.
      expect(Object.keys(getUniqueColumnsBy(new MessageQueue()))).toEqual([]);
    });

    test("declares IDX_message_queue_slug by name, UNIQUE and partial", () => {
      /*
       * TypeORM's schema builder matches database indexes to entity
       * metadata by name and drops every one it cannot find, so the partial
       * slug index must be declared natively and named.
       */
      const found: IndexMetadataArgs | undefined = namedIndex(
        MessageQueue,
        "IDX_message_queue_slug",
      );

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.columns).toEqual(["slug"]);
      expect(found?.where).toBe('"deletedAt" IS NULL');
    });

    test("names exactly two indexes - the partial unique ones", () => {
      const named: Array<string> = classIndexes(MessageQueue)
        .map((index: IndexMetadataArgs): string => {
          return index.name || "";
        })
        .filter((name: string): boolean => {
          return name.length > 0;
        })
        .sort();

      expect(named).toEqual([
        "IDX_message_queue_identifier",
        "IDX_message_queue_slug",
      ]);
    });

    test("indexes the list-page filters: (projectId, isArchived) and (projectId, messagingSystem)", () => {
      const archived: IndexMetadataArgs | undefined = indexOnColumns(
        MessageQueue,
        ["projectId", "isArchived"],
      );
      const system: IndexMetadataArgs | undefined = indexOnColumns(
        MessageQueue,
        ["projectId", "messagingSystem"],
      );

      expect(archived).toBeDefined();
      expect(archived?.unique).not.toBe(true);
      expect(system).toBeDefined();
      expect(system?.unique).not.toBe(true);
    });

    test("indexes projectId, name and queueIdentifier on their own", () => {
      for (const column of ["projectId", "name", "queueIdentifier"]) {
        expect({
          column,
          indexed: Boolean(propertyIndex(MessageQueue, column)),
        }).toEqual({ column, indexed: true });
      }
    });

    test("carries every column of the SPEC schema", () => {
      const columns: Array<string> = model.getTableColumns().columns;

      for (const column of [
        ...MESSAGE_QUEUE_USER_CREATE_COLUMNS,
        ...MESSAGE_QUEUE_ROOT_ONLY_COLUMNS,
      ]) {
        expect({ column, present: columns.includes(column) }).toEqual({
          column,
          present: true,
        });
      }

      // No retention / AI / workload / collector columns, and no consumer groups.
      for (const column of [
        "retainTelemetryDataForDays",
        "telemetryRetentionConfig",
        "isAiInvestigationEnabled",
        "aiRemediationMode",
        "workloadIdentifier",
        "memberEntityKeys",
        "otelCollectorStatus",
        "collectorLastSeenAt",
        "consumerGroups",
        "databaseIdentifier",
        "dbSystem",
      ]) {
        expect(columns).not.toContain(column);
      }
    });

    test("every declared column is accounted for as user-creatable or root-only", () => {
      /*
       * A new column must be placed in one of the two lists above on
       * purpose - which is what decides whether a manual create can set it.
       */
      const accounted: Set<string> = new Set([
        ...MESSAGE_QUEUE_USER_CREATE_COLUMNS,
        ...MESSAGE_QUEUE_ROOT_ONLY_COLUMNS,
      ]);
      const unaccounted: Array<string> = ownColumns(model).filter(
        (column: string): boolean => {
          return !accounted.has(column);
        },
      );

      expect(unaccounted).toEqual([]);
    });

    test("column types and widths follow the SPEC", () => {
      const expectations: Array<
        [string, TableColumnType, boolean, number | undefined]
      > = [
        // column, type, required, varchar length
        ["name", TableColumnType.ShortText, true, ColumnLength.ShortText],
        ["description", TableColumnType.LongText, false, ColumnLength.LongText],
        [
          "queueIdentifier",
          TableColumnType.LongText,
          true,
          ColumnLength.LongText,
        ],
        [
          "messagingSystem",
          TableColumnType.ShortText,
          true,
          ColumnLength.ShortText,
        ],
        [
          "destinationName",
          TableColumnType.LongText,
          true,
          ColumnLength.LongText,
        ],
        [
          "brokerScope",
          TableColumnType.ShortText,
          false,
          ColumnLength.ShortText,
        ],
        [
          "brokerAddress",
          TableColumnType.LongText,
          false,
          ColumnLength.LongText,
        ],
        [
          "discoverySource",
          TableColumnType.ShortText,
          false,
          ColumnLength.ShortText,
        ],
        ["lastSeenAt", TableColumnType.Date, false, undefined],
        ["brokerMetricsLastSeenAt", TableColumnType.Date, false, undefined],
        ["autoArchivedAt", TableColumnType.Date, false, undefined],
        ["manuallyRestoredAt", TableColumnType.Date, false, undefined],
        ["automaticAssignments", TableColumnType.JSON, false, undefined],
        ["archivedAt", TableColumnType.Date, false, undefined],
        ["createdByUserId", TableColumnType.ObjectID, false, undefined],
      ];

      for (const [column, type, required, length] of expectations) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);
        const options: ColumnMetadataArgs["options"] = columnArgs(
          MessageQueue,
          column,
        ).options;

        expect({ column, type: metadata.type }).toEqual({ column, type });
        expect({ column, required: Boolean(metadata.required) }).toEqual({
          column,
          required,
        });
        expect({ column, nullable: options.nullable }).toEqual({
          column,
          nullable: !required,
        });
        expect({ column, length: options.length }).toEqual({ column, length });
      }
    });

    test("the widths hold everything the identity module can produce", () => {
      /*
       * A resolved destination is at most 255 characters, a display name
       * 100 and an identifier 500 - a value past its column would fail the
       * insert rather than be stored.
       */
      expect(MESSAGE_QUEUE_DESTINATION_MAX_LENGTH).toBeLessThanOrEqual(
        ColumnLength.LongText,
      );
      expect(MESSAGE_QUEUE_IDENTIFIER_MAX_LENGTH).toBeLessThanOrEqual(
        ColumnLength.LongText,
      );
      expect(MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH).toBeLessThanOrEqual(
        ColumnLength.ShortText,
      );

      // Every catalogued system name fits the ShortText system column.
      for (const descriptor of MESSAGING_SYSTEMS) {
        expect(descriptor.system.length).toBeLessThanOrEqual(
          ColumnLength.ShortText,
        );
      }
    });

    test("automaticAssignments is jsonb; new rows are not archived and carry no invented defaults", () => {
      expect(
        columnArgs(MessageQueue, "automaticAssignments").options.type,
      ).toBe("jsonb");
      expect(columnArgs(MessageQueue, "isArchived").options.default).toBe(
        false,
      );
      expect(columnArgs(MessageQueue, "isArchived").options.nullable).toBe(
        false,
      );
      expect(model.isDefaultValueColumn("isArchived")).toBe(true);

      // No DB default where "unknown" must stay NULL.
      for (const column of [
        "lastSeenAt",
        "brokerMetricsLastSeenAt",
        "autoArchivedAt",
        "manuallyRestoredAt",
        "automaticAssignments",
        "discoverySource",
        "brokerScope",
        "brokerAddress",
      ]) {
        expect({
          column,
          default: columnArgs(MessageQueue, column).options.default,
        }).toEqual({ column, default: undefined });
      }
    });

    test("the identifier column documents the family-keyed form, and its example is one", () => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata("queueIdentifier");

      expect(metadata.description).toContain("family");
      expect(metadata.description).toContain("jms");

      const example: string = String(metadata.example);
      const parsed: MessageQueueIdentity | null =
        parseMessageQueueIdentifier(example);

      expect(parsed).not.toBeNull();
      expect(buildMessageQueueIdentifier(parsed!)).toBe(example);
      expect(example).toBe(
        buildMessageQueueIdentifier({
          system: "kafka",
          brokerScope: "",
          destination: "orders.created",
        }),
      );
    });

    test("the messaging system column names catalogued systems in its example", () => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata("messagingSystem");
      const systems: Array<string> = MESSAGING_SYSTEMS.map(
        (descriptor: MessagingSystemDescriptor): string => {
          return descriptor.system;
        },
      );

      expect(systems).toContain(String(metadata.example));
    });

    test("slug is computed from name and is never user-writable", () => {
      expect(model.getSlugifyColumn()).toBe("name");
      expect(model.getSaveSlugToColumn()).toBe("slug");
      expect(model.getTableColumnMetadata("slug").computed).toBe(true);
      expect(model.getTableColumnMetadata("slug").type).toBe(
        TableColumnType.Slug,
      );
    });

    test("table access control: Settings / project roles plus the granular MessageQueue permissions", () => {
      const writeRoles: Array<Permission> = [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.SettingsAdmin,
        Permission.SettingsMember,
      ];

      expect(sorted(model.getCreatePermissions())).toEqual(
        sorted([...writeRoles, Permission.CreateMessageQueue]),
      );
      expect(sorted(model.getUpdatePermissions())).toEqual(
        sorted([...writeRoles, Permission.EditMessageQueue]),
      );
      expect(sorted(model.getDeletePermissions())).toEqual(
        sorted([...writeRoles, Permission.DeleteMessageQueue]),
      );
      expect(sorted(model.getReadPermissions())).toEqual(
        sorted([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.SettingsAdmin,
          Permission.SettingsMember,
          Permission.SettingsViewer,
          Permission.ReadMessageQueue,
        ]),
      );
    });

    test("is label-access-controlled and not a telemetry-owning operational resource", () => {
      expect(model.accessControlColumn).toBe("labels");
      expect(model.enableWorkflowOn).toBeFalsy();
    });

    test.each(MESSAGE_QUEUE_USER_CREATE_COLUMNS)(
      "%s is creatable by exactly the table's create roles (COLUMN ACL RULE)",
      (column: string) => {
        /*
         * DatabaseService.create runs onBeforeCreate BEFORE
         * ModelPermission.checkCreatePermissions. A column the service sets
         * during a manual create that the caller may not create turns every
         * manual create into "User is not allowed to create on <column>".
         */
        expect(sorted(columnAccess(model, column).create || [])).toEqual(
          sorted(model.getCreatePermissions()),
        );
      },
    );

    test.each(MESSAGE_QUEUE_ROOT_ONLY_COLUMNS)(
      "%s is root-only: nobody creates or updates it through the API",
      (column: string) => {
        const accessControl: ColumnAccessControl = columnAccess(model, column);

        expect(accessControl.create || []).toEqual([]);
        expect(accessControl.update || []).toEqual([]);
      },
    );

    test("identity columns are creatable but never updatable", () => {
      /*
       * Re-pointing a row at another system, namespace or destination by
       * editing it would silently hand its history to another queue.
       * messagingSystem changes only by discovery's refinement, as root.
       */
      for (const column of [
        "projectId",
        "queueIdentifier",
        "messagingSystem",
        "destinationName",
        "brokerScope",
        "discoverySource",
        "createdByUserId",
      ]) {
        expect({ column, update: columnAccess(model, column).update }).toEqual({
          column,
          update: [],
        });
      }
    });

    test.each(MESSAGE_QUEUE_USER_UPDATE_COLUMNS)(
      "%s is updatable by exactly the table's update roles",
      (column: string) => {
        expect(sorted(columnAccess(model, column).update || [])).toEqual(
          sorted(model.getUpdatePermissions()),
        );
      },
    );

    test("no other column is user-updatable", () => {
      const updatable: Array<string> = ownColumns(model).filter(
        (column: string): boolean => {
          return (columnAccess(model, column).update || []).length > 0;
        },
      );

      expect(updatable.sort()).toEqual(
        [...MESSAGE_QUEUE_USER_UPDATE_COLUMNS].sort(),
      );
    });

    test("every column is readable by exactly the table's read roles", () => {
      for (const column of ownColumns(model)) {
        expect({
          column,
          read: sorted(columnAccess(model, column).read || []),
        }).toEqual({ column, read: sorted(model.getReadPermissions()) });
      }
    });

    describe("against the real permission checks", () => {
      test.each([
        ["ProjectOwner", [Permission.ProjectOwner]],
        ["ProjectMember", [Permission.ProjectMember]],
        ["SettingsAdmin", [Permission.SettingsAdmin]],
        ["SettingsMember", [Permission.SettingsMember]],
        ["CreateMessageQueue only", [Permission.CreateMessageQueue]],
      ])(
        "a manual create as %s passes table and column checks",
        (_label: string, permissions: Array<Permission>) => {
          expect(
            checkCreate(MessageQueue, manualCreateData(), permissions),
          ).not.toThrow();
        },
      );

      test("a manual create with labels and an archive flag passes too", () => {
        const data: MessageQueue = manualCreateData();
        const label: Label = new Label();
        label._id = ObjectID.generate().toString();
        data.labels = [label];
        data.isArchived = false;

        expect(
          checkCreate(MessageQueue, data, [Permission.CreateMessageQueue]),
        ).not.toThrow();
      });

      test("a Viewer or SettingsViewer may not add a queue", () => {
        for (const permission of [
          Permission.Viewer,
          Permission.SettingsViewer,
        ]) {
          expect(
            checkCreate(MessageQueue, manualCreateData(), [permission]),
          ).toThrow();
        }
      });

      test.each(
        MESSAGE_QUEUE_ROOT_ONLY_COLUMNS.filter((column: string): boolean => {
          // slug is a Slug column, which ColumnPermission always skips.
          return column !== "slug";
        }),
      )("a non-root create carrying %s is refused", (column: string) => {
        const data: MessageQueue = manualCreateData();
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);
        let value: unknown = "value";

        if (metadata.type === TableColumnType.ObjectID) {
          value = ObjectID.generate();
        } else if (metadata.type === TableColumnType.Date) {
          value = new Date();
        } else if (metadata.type === TableColumnType.JSON) {
          value = { labelIds: [ObjectID.generate().toString()] };
        } else if (metadata.type === TableColumnType.Entity) {
          value = { _id: ObjectID.generate().toString() };
        }

        (data as unknown as Record<string, unknown>)[column] = value;

        expect(
          checkColumns(
            MessageQueue,
            data,
            [Permission.ProjectOwner],
            DatabaseRequestType.Create,
          ),
        ).toThrow(`User is not allowed to create on ${column} column of Queue`);
      });

      test("an update may rename, describe and archive", () => {
        const data: MessageQueue = new MessageQueue();
        data.name = "Orders (prod)";
        data.description = "Renamed";
        data.isArchived = true;

        expect(
          checkColumns(
            MessageQueue,
            data,
            [Permission.EditMessageQueue],
            DatabaseRequestType.Update,
          ),
        ).not.toThrow();
      });

      test.each([
        "queueIdentifier",
        "messagingSystem",
        "destinationName",
        "brokerScope",
        "discoverySource",
        "brokerAddress",
      ])(
        "an update of %s is refused even for a project owner",
        (column: string) => {
          const data: MessageQueue = new MessageQueue();
          (data as unknown as Record<string, unknown>)[column] = "x";

          expect(
            checkColumns(
              MessageQueue,
              data,
              [Permission.ProjectOwner],
              DatabaseRequestType.Update,
            ),
          ).toThrow(
            `User is not allowed to update on ${column} column of Queue`,
          );
        },
      );

      test("a reader may not archive a queue", () => {
        const data: MessageQueue = new MessageQueue();
        data.isArchived = true;

        expect(
          checkColumns(
            MessageQueue,
            data,
            [Permission.ReadMessageQueue],
            DatabaseRequestType.Update,
          ),
        ).toThrow(BadDataException);
      });
    });

    test("labels drive access control through the MessageQueueLabel join table", () => {
      expect(model.accessControlColumn).toBe("labels");

      const joinTable: JoinTableMetadataArgs = joinTableArgs(
        MessageQueue,
        "labels",
      );

      expect(joinTable.name).toBe("MessageQueueLabel");
      expect(joinTable.joinColumns?.[0]?.name).toBe("messageQueueId");
      expect(joinTable.inverseJoinColumns?.[0]?.name).toBe("labelId");
      expect(model.getTableColumnMetadata("labels").modelType).toBe(Label);
      expect(relationArgs(MessageQueue, "labels").relationType).toBe(
        "many-to-many",
      );
    });

    test("the project relation cascades; the user relations survive their user", () => {
      expect(relationArgs(MessageQueue, "project").options.onDelete).toBe(
        "CASCADE",
      );

      for (const [property, idColumn] of [
        ["createdByUser", "createdByUserId"],
        ["archivedByUser", "archivedByUserId"],
        ["deletedByUser", "deletedByUserId"],
      ] as Array<[string, string]>) {
        expect(relationArgs(MessageQueue, property).options.onDelete).toBe(
          "SET NULL",
        );
        expect(joinColumnArgs(MessageQueue, property).name).toBe(idColumn);
        expect(model.getTableColumnMetadata(property).modelType).toBe(User);
      }
    });

    test("the identity and liveness columns can be read through a relation query", () => {
      for (const column of [
        "projectId",
        "name",
        "description",
        "queueIdentifier",
        "messagingSystem",
        "destinationName",
        "brokerScope",
        "discoverySource",
        "lastSeenAt",
      ]) {
        expect({
          column,
          canRead: Boolean(
            model.getTableColumnMetadata(column).canReadOnRelationQuery,
          ),
        }).toEqual({ column, canRead: true });
      }
    });

    test("the initialisers are in place - BaseModel enumerates own properties", () => {
      for (const column of ownColumns(model)) {
        expect({
          column,
          own: Object.prototype.hasOwnProperty.call(model, column),
        }).toEqual({ column, own: true });
      }
    });
  });

  describe("discovery sources", () => {
    test("are exactly traces, broker-metrics and manual", () => {
      expect([...MESSAGE_QUEUE_DISCOVERY_SOURCES]).toEqual([
        "traces",
        "broker-metrics",
        "manual",
      ]);
    });

    test.each([
      ["traces", "Application traces"],
      ["broker-metrics", "Broker metrics"],
      ["manual", "Added manually"],
      [" Manual ", "Added manually"],
      ["something-else", "something-else"],
      // A Map lookup: an inherited property name is shown as it is.
      ["constructor", "constructor"],
      ["", ""],
    ])("labels %p as %p", (source: string, label: string) => {
      expect(getMessageQueueDiscoverySourceLabel(source)).toBe(label);
    });

    test("labels a non-string as nothing", () => {
      expect(getMessageQueueDiscoverySourceLabel(undefined)).toBe("");
      expect(getMessageQueueDiscoverySourceLabel(null)).toBe("");
      expect(getMessageQueueDiscoverySourceLabel(42)).toBe("");
    });

    test("the discoverySource column documents every source", () => {
      const description: string =
        new MessageQueue().getTableColumnMetadata("discoverySource")
          .description || "";

      for (const source of MESSAGE_QUEUE_DISCOVERY_SOURCES) {
        expect(description).toContain(source);
      }
    });
  });

  describe("children of MessageQueue", () => {
    test.each(MESSAGE_QUEUE_CHILDREN)(
      "%p.%s cascades on queue delete and carries a required messageQueueId",
      (modelType: ModelType, property: string) => {
        const relation: RelationMetadataArgs = relationArgs(
          modelType,
          property,
        );

        expect(relation.relationType).toBe("many-to-one");
        expect(relation.options.onDelete).toBe("CASCADE");

        const model: BaseModel = new modelType();

        expect(model.getTableColumns().columns).toContain("messageQueueId");
        expect(
          model.getTableColumnMetadata(property).manyToOneRelationColumn,
        ).toBe("messageQueueId");
        expect(model.getTableColumnMetadata(property).modelType).toBe(
          MessageQueue,
        );
        expect(model.getTableColumnMetadata("messageQueueId").required).toBe(
          true,
        );
        expect(columnArgs(modelType, "messageQueueId").options.nullable).toBe(
          false,
        );
        expect(joinColumnArgs(modelType, property).name).toBe("messageQueueId");
      },
    );

    test.each([
      [
        MessageQueueOwnerTeam,
        "teamId",
        "This team is already an owner of this queue.",
      ],
      [
        MessageQueueOwnerUser,
        "userId",
        "This user is already an owner of this queue.",
      ],
    ] as Array<[ModelType, string, string]>)(
      "%p allows one row per (queue, owner, project)",
      (modelType: ModelType, ownerColumn: string, message: string) => {
        const unique: IndexMetadataArgs | undefined = indexOnColumns(
          modelType,
          ["messageQueueId", ownerColumn, "projectId"],
        );

        expect(unique).toBeDefined();
        expect(unique?.unique).toBe(true);

        const constraints: Array<UniqueColumnsTogetherMetadata> =
          new modelType().getUniqueColumnsTogether();

        expect(constraints).toHaveLength(1);
        expect(constraints[0]!.columnNames).toEqual([
          "messageQueueId",
          ownerColumn,
          "projectId",
        ]);
        expect(constraints[0]!.errorMessage).toBe(message);
      },
    );

    test.each([
      [MessageQueueOwnerTeam, "team", Team],
      [MessageQueueOwnerUser, "user", User],
    ] as Array<[ModelType, string, ModelType]>)(
      "%p's owner relation cascades and its key is required",
      (modelType: ModelType, property: string, ownerModel: ModelType) => {
        const model: BaseModel = new modelType();

        expect(model.getTableColumnMetadata(property).modelType).toBe(
          ownerModel,
        );
        expect(relationArgs(modelType, property).options.onDelete).toBe(
          "CASCADE",
        );
        expect(model.getTableColumnMetadata(`${property}Id`).required).toBe(
          true,
        );
        expect(columnArgs(modelType, `${property}Id`).options.nullable).toBe(
          false,
        );
      },
    );

    test("owner rows carry the isOwnerNotified flag, which only the server sets", () => {
      // Owner rule assignment stamps it (OwnerRuleAssignment.createOwner).
      for (const modelType of [
        MessageQueueOwnerTeam,
        MessageQueueOwnerUser,
      ] as Array<ModelType>) {
        const model: BaseModel = new modelType();

        expect(model.getTableColumns().columns).toContain("isOwnerNotified");
        expect(columnAccess(model, "isOwnerNotified").create).toEqual([]);
        expect(columnArgs(modelType, "isOwnerNotified").options.default).toBe(
          false,
        );
        expect(model.enableWorkflowOn).toBeTruthy();
      }
    });

    test.each([
      [MessageQueueOwnerTeam, "OwnerTeam"],
      [MessageQueueOwnerUser, "OwnerUser"],
    ] as Array<[ModelType, string]>)(
      "%p gates on its own %s permissions",
      (modelType: ModelType, kind: string) => {
        const model: BaseModel = new modelType();

        expect(model.getCreatePermissions()).toContain(
          `CreateMessageQueue${kind}` as Permission,
        );
        expect(model.getReadPermissions()).toContain(
          `ReadMessageQueue${kind}` as Permission,
        );
        expect(model.getUpdatePermissions()).toContain(
          `EditMessageQueue${kind}` as Permission,
        );
        expect(model.getDeletePermissions()).toContain(
          `DeleteMessageQueue${kind}` as Permission,
        );
      },
    );

    test.each([
      [MessageQueueOwnerTeam, [Permission.CreateMessageQueueOwnerTeam]],
      [MessageQueueOwnerUser, [Permission.CreateMessageQueueOwnerUser]],
    ] as Array<[ModelType, Array<Permission>]>)(
      "a person adding an owner row to %p passes the real create check",
      (modelType: ModelType, permissions: Array<Permission>) => {
        const data: BaseModel = new modelType();
        data.setColumnValue("projectId", PROJECT_ID);
        data.setColumnValue("messageQueueId", ObjectID.generate());
        data.setColumnValue(
          modelType === MessageQueueOwnerTeam ? "teamId" : "userId",
          ObjectID.generate(),
        );

        expect(checkCreate(modelType, data, permissions)).not.toThrow();
        expect(
          checkCreate(modelType, data, [Permission.ReadMessageQueue]),
        ).toThrow();
      },
    );
  });

  describe("rule models", () => {
    test.each([
      [MessageQueueLabelRule, "LabelRule"],
      [MessageQueueOwnerRule, "OwnerRule"],
    ] as Array<[ModelType, string]>)(
      "%p is a RuleBaseModel whose criteria column follows the table ACL",
      (modelType: ModelType, kind: string) => {
        const model: BaseModel = new modelType();

        expect(model).toBeInstanceOf(RuleBaseModel);
        expect(model.getTableColumnMetadata("criteria").type).toBe(
          TableColumnType.JSON,
        );
        expect(model.getColumnAccessControlFor("criteria")).toEqual({
          create: model.getCreatePermissions(),
          read: model.getReadPermissions(),
          update: model.getUpdatePermissions(),
        });

        // Rule tables: owners and admins write, members and viewers read.
        expect(sorted(model.getCreatePermissions())).toEqual(
          sorted([
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            `CreateMessageQueue${kind}` as Permission,
          ]),
        );
        expect(sorted(model.getReadPermissions())).toEqual(
          sorted([
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.Viewer,
            `ReadMessageQueue${kind}` as Permission,
          ]),
        );
        expect(model.enableWorkflowOn).toBeTruthy();
      },
    );

    test.each([
      MessageQueueLabelRule,
      MessageQueueOwnerRule,
    ] as Array<ModelType>)(
      "%p matches on exactly the four registered criteria fields",
      (modelType: ModelType) => {
        /*
         * RuleCriteriaFieldRegistry, the rule engines' legacyFields and the
         * dashboard's match-criteria step all list these four names; a
         * rename here breaks all three silently.
         */
        const model: BaseModel = new modelType();
        const columns: Array<string> = model.getTableColumns().columns;

        const matchColumns: Array<string> = columns.filter(
          (column: string): boolean => {
            return column.startsWith("messageQueue");
          },
        );

        expect(matchColumns.sort()).toEqual([...RULE_CRITERIA_FIELDS].sort());

        expect(model.getTableColumnMetadata("messageQueueLabels").type).toBe(
          TableColumnType.EntityArray,
        );
        expect(
          model.getTableColumnMetadata("messageQueueLabels").modelType,
        ).toBe(Label);

        for (const pattern of [
          "messageQueueNamePattern",
          "messageQueueDescriptionPattern",
          "messageQueueSystemPattern",
        ]) {
          expect(model.getTableColumnMetadata(pattern).type).toBe(
            TableColumnType.LongText,
          );
          expect(model.getTableColumnMetadata(pattern).required).toBeFalsy();
          expect(columnArgs(modelType, pattern).options.nullable).toBe(true);
          expect(sorted(columnAccess(model, pattern).update || [])).toEqual(
            sorted(model.getUpdatePermissions()),
          );
        }
      },
    );

    test.each([
      [MessageQueueLabelRule, "LabelRule"],
      [MessageQueueOwnerRule, "OwnerRule"],
    ] as Array<[ModelType, string]>)(
      "%p: every criteria field is created, read and updated by exactly the table's roles",
      (modelType: ModelType, kind: string) => {
        /*
         * An empty create or read list fails nothing else loudly: the column
         * drops out of the portable label rule file
         * (ModelImportExport.getImportExportableColumnNames skips it) - an
         * exported "Kafka only" rule re-imports as one that matches every
         * queue - and the rule form's create is refused for anyone who
         * fills the field in.
         */
        const model: BaseModel = new modelType();

        for (const column of RULE_CRITERIA_FIELDS) {
          const accessControl: ColumnAccessControl = columnAccess(
            model,
            column,
          );

          expect({
            column,
            create: sorted(accessControl.create || []),
            read: sorted(accessControl.read || []),
            update: sorted(accessControl.update || []),
          }).toEqual({
            column,
            create: sorted(model.getCreatePermissions()),
            read: sorted(model.getReadPermissions()),
            update: sorted(model.getUpdatePermissions()),
          });
        }

        // And through the real column check, every field set at once.
        const data: BaseModel = new modelType();
        const label: Label = new Label();
        label._id = ObjectID.generate().toString();
        data.setColumnValue("messageQueueLabels", [label]);
        data.setColumnValue("messageQueueNamePattern", "^orders\\.");
        data.setColumnValue("messageQueueDescriptionPattern", "payments");
        data.setColumnValue("messageQueueSystemPattern", "^kafka$");

        expect(
          checkColumns(
            modelType,
            data,
            [`CreateMessageQueue${kind}` as Permission],
            DatabaseRequestType.Create,
          ),
        ).not.toThrow();
        expect(
          checkColumns(
            modelType,
            data,
            [`EditMessageQueue${kind}` as Permission],
            DatabaseRequestType.Update,
          ),
        ).not.toThrow();
        expect(
          checkColumns(
            modelType,
            data,
            [`ReadMessageQueue${kind}` as Permission],
            DatabaseRequestType.Create,
          ),
        ).toThrow(BadDataException);
      },
    );

    test("label rule attaches labels through its own join tables", () => {
      const model: MessageQueueLabelRule = new MessageQueueLabelRule();

      for (const column of [
        "name",
        "description",
        "isEnabled",
        "labelsToAdd",
      ]) {
        expect(model.getTableColumns().columns).toContain(column);
      }

      const matchLabels: JoinTableMetadataArgs = joinTableArgs(
        MessageQueueLabelRule,
        "messageQueueLabels",
      );

      expect(matchLabels.name).toBe("MessageQueueLabelRuleMessageQueueLabel");
      expect(matchLabels.joinColumns?.[0]?.name).toBe(
        "messageQueueLabelRuleId",
      );
      expect(matchLabels.inverseJoinColumns?.[0]?.name).toBe("labelId");

      const labelsToAdd: JoinTableMetadataArgs = joinTableArgs(
        MessageQueueLabelRule,
        "labelsToAdd",
      );

      expect(labelsToAdd.name).toBe("MessageQueueLabelRuleLabelToAdd");
      expect(labelsToAdd.joinColumns?.[0]?.name).toBe(
        "messageQueueLabelRuleId",
      );
    });

    test("owner rule assigns users and teams through its own join tables", () => {
      const model: MessageQueueOwnerRule = new MessageQueueOwnerRule();

      for (const column of [
        "name",
        "description",
        "isEnabled",
        "notifyOwners",
        "ownerUsers",
        "ownerTeams",
      ]) {
        expect(model.getTableColumns().columns).toContain(column);
      }

      expect(columnArgs(MessageQueueOwnerRule, "notifyOwners").options).toEqual(
        expect.objectContaining({ nullable: false, default: true }),
      );

      expect(
        joinTableArgs(MessageQueueOwnerRule, "messageQueueLabels").name,
      ).toBe("MessageQueueOwnerRuleMessageQueueLabel");
      expect(joinTableArgs(MessageQueueOwnerRule, "ownerUsers").name).toBe(
        "MessageQueueOwnerRuleOwnerUser",
      );
      expect(joinTableArgs(MessageQueueOwnerRule, "ownerTeams").name).toBe(
        "MessageQueueOwnerRuleOwnerTeam",
      );

      for (const property of [
        "messageQueueLabels",
        "ownerUsers",
        "ownerTeams",
      ]) {
        expect(
          joinTableArgs(MessageQueueOwnerRule, property).joinColumns?.[0]?.name,
        ).toBe("messageQueueOwnerRuleId");
      }
    });

    test("the patterns tell people a queue's name is its destination and how to match a broker", () => {
      for (const modelType of [
        MessageQueueLabelRule,
        MessageQueueOwnerRule,
      ] as Array<ModelType>) {
        const model: BaseModel = new modelType();

        expect(
          model.getTableColumnMetadata("messageQueueNamePattern").description,
        ).toContain("destination");
        expect(
          model.getTableColumnMetadata("messageQueueSystemPattern").title,
        ).toBe("Messaging System Pattern");

        const systemDescription: string =
          model.getTableColumnMetadata("messageQueueSystemPattern")
            .description || "";

        // Both forms the engines match against are documented.
        expect(systemDescription).toContain("messaging.system");
        expect(systemDescription).toContain("Apache Kafka");
        expect(systemDescription).toContain("^kafka$");
      }
    });

    test("deletedBy columns are hidden on rule tables, like every rule table", () => {
      for (const modelType of [
        MessageQueueLabelRule,
        MessageQueueOwnerRule,
      ] as Array<ModelType>) {
        const model: BaseModel = new modelType();

        for (const column of ["deletedByUser", "deletedByUserId"]) {
          expect(columnAccess(model, column)).toEqual({
            create: [],
            read: [],
            update: [],
          });
        }
      }
    });
  });

  describe("Postgres identifier limits", () => {
    /*
     * Postgres silently truncates identifiers to 63 bytes, so two long names
     * that share a prefix become the same table, and a generated migration
     * never matches its own output again.
     */
    const LIMIT: number = 63;

    test("every table, join table, join column and named index fits", () => {
      const names: Array<string> = [];
      const targets: Array<unknown> = QUEUE_MODELS.map(
        (spec: QueueModelSpec): unknown => {
          return spec.modelType;
        },
      );

      for (const spec of QUEUE_MODELS) {
        names.push(spec.tableName);
      }

      for (const joinTable of getMetadataArgsStorage()
        .joinTables as Array<JoinTableMetadataArgs>) {
        if (!targets.includes(joinTable.target)) {
          continue;
        }

        names.push(joinTable.name!);

        for (const column of [
          ...(joinTable.joinColumns || []),
          ...(joinTable.inverseJoinColumns || []),
        ]) {
          names.push(column.name!);
        }
      }

      for (const target of targets) {
        for (const index of classIndexes(target as ModelType)) {
          if (index.name) {
            names.push(index.name);
          }
        }
      }

      // 5 tables, 6 join tables with 12 columns, 2 named indexes.
      expect(names.length).toBe(25);

      const tooLong: Array<string> = names.filter((name: string): boolean => {
        return name.length > LIMIT;
      });

      expect(tooLong).toEqual([]);
    });

    test("every column name fits", () => {
      for (const spec of QUEUE_MODELS) {
        for (const column of new spec.modelType().getTableColumns().columns) {
          expect(column.length).toBeLessThanOrEqual(LIMIT);
        }
      }
    });
  });

  describe("permissions", () => {
    test("all 20 permissions exist in the enum and the catalogue", () => {
      const enumValues: Set<string> = new Set(Object.values(Permission));

      for (const name of MESSAGE_QUEUE_PERMISSIONS) {
        expect(enumValues.has(name)).toBe(true);
        expect(Permission[name as keyof typeof Permission]).toBe(name);

        const props: PermissionProps | undefined =
          PERMISSION_PROPS_BY_NAME.get(name);

        expect(props).toBeDefined();
        expect(props!.isAssignableToTenant).toBe(true);
        expect(props!.isRolePermission).toBe(false);
        expect(props!.group).toBe("Telemetry");
        expect(props!.title).toContain("Queue");
        expect(props!.title).not.toContain("MessageQueue");
        expect(props!.title).not.toContain("Database");
        expect(props!.description.length).toBeGreaterThan(0);
        expect(props!.description).not.toContain("Database");
        expect(props!.description.endsWith(".")).toBe(true);

        // The lookups the permission UI and the error messages use.
        expect(PermissionHelper.getTitle(name as Permission)).toBe(
          props!.title,
        );
        expect(PermissionHelper.getDescription(name as Permission)).toBe(
          props!.description,
        );
      }

      // No stray members - the catalogue must not sprout a 21st.
      const members: Array<string> = Array.from(enumValues).filter(
        (value: string) => {
          return value.includes("MessageQueue");
        },
      );

      expect(members.sort()).toEqual([...MESSAGE_QUEUE_PERMISSIONS].sort());
    });

    test("each permission appears exactly once in the props catalogue", () => {
      for (const name of MESSAGE_QUEUE_PERMISSIONS) {
        expect(
          PERMISSION_PROPS.filter((props: PermissionProps): boolean => {
            return props.permission.toString() === name;
          }),
        ).toHaveLength(1);
      }
    });

    test("titles are unique among the catalogue", () => {
      for (const name of MESSAGE_QUEUE_PERMISSIONS) {
        const title: string = PERMISSION_PROPS_BY_NAME.get(name)!.title;

        expect(
          PERMISSION_PROPS.filter((props: PermissionProps): boolean => {
            return props.title === title;
          }),
        ).toHaveLength(1);
      }
    });

    test("queue Delete/Edit/Read are label-scoped access-control permissions; nothing else is", () => {
      for (const name of MESSAGE_QUEUE_PERMISSIONS) {
        const props: PermissionProps = PERMISSION_PROPS_BY_NAME.get(name)!;
        const labelScoped: boolean = [
          "DeleteMessageQueue",
          "EditMessageQueue",
          "ReadMessageQueue",
        ].includes(name);

        expect({ name, flag: props.isAccessControlPermission }).toEqual({
          name,
          flag: labelScoped,
        });
      }
    });

    test("there is no queue feed, so no feed permissions", () => {
      for (const name of [
        "CreateMessageQueueFeed",
        "EditMessageQueueFeed",
        "ReadMessageQueueFeed",
      ]) {
        expect(Object.values(Permission)).not.toContain(name);
      }
    });

    test.each(QUEUE_MODELS)(
      "$name references only real, catalogued permissions",
      (spec: QueueModelSpec) => {
        const enumValues: Set<string> = new Set(Object.values(Permission));
        const model: BaseModel = new spec.modelType();

        for (const permission of allReferencedPermissions(model)) {
          const value: string = permission.toString();

          expect(enumValues.has(value)).toBe(true);
          expect(PERMISSION_PROPS_BY_NAME.has(value)).toBe(true);
        }
      },
    );

    test.each(QUEUE_MODELS)(
      "$name gates on Queue permissions, never on another product's",
      (spec: QueueModelSpec) => {
        const model: BaseModel = new spec.modelType();

        for (const permission of allReferencedPermissions(model)) {
          const value: string = permission.toString();

          expect(value).not.toContain("DatabaseServer");
          expect(value).not.toContain("Ceph");
          expect(value).not.toContain("ServerlessFunction");
        }
      },
    );

    test.each(QUEUE_MODELS)(
      "$name has no column that requires a permission its table does not accept on create",
      (spec: QueueModelSpec) => {
        /*
         * The PermissionCatalogueCoverage sweep, scoped: a granular holder
         * that passes the table gate must not fail on a column gate.
         */
        const model: BaseModel = new spec.modelType();
        const roles: Set<string> = new Set(
          PermissionHelper.getRolePermissionProps().map(
            (props: PermissionProps): string => {
              return props.permission.toString();
            },
          ),
        );
        const tableCreate: Set<string> = new Set(
          sorted(model.getCreatePermissions()),
        );

        for (const column of ownColumns(model)) {
          for (const permission of columnAccess(model, column).create || []) {
            const value: string = permission.toString();

            expect({
              column,
              value,
              ok: roles.has(value) || tableCreate.has(value),
            }).toEqual({ column, value, ok: true });
          }
        }
      },
    );
  });
});
