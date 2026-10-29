import DataStore from "./DataStore";
import Project from "./Project";
import Service from "./Service";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import EnableMCP from "../../Types/Database/EnableMCP";
import DataSensitivity from "../../Types/DataSecurity/DataSensitivity";
import ColumnLength from "../../Types/Database/ColumnLength";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One edge of where data goes: a store read or written by a service (from
 * the service map), a service sending data to an external host or an AI
 * provider, or a store holding copies of another store's values (from
 * fingerprints).
 *
 * Computed by OneUptime from traces and scans; nobody writes a row. The Data
 * Flows page draws them, and a flow of Restricted data to an AI provider or
 * another region becomes an issue once a scan confirms the data reached it.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataSecurityFlow,
];

const createPermissions: Array<Permission> = [];

const updatePermissions: Array<Permission> = [];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteDataSecurityFlow,
];

// Columns OneUptime writes; people read them.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@EnableMCP()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/data-security-flow"))
@Entity({
  name: "DataSecurityFlow",
})
@TableMetadata({
  tableName: "DataSecurityFlow",
  singularName: "Data Flow",
  pluralName: "Data Flows",
  icon: IconProp.Graph,
  tableDescription:
    "Where sensitive data goes: the services that read each store, where those services send data, and copies of a store's data found in another store.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
  delete: deletePermissions,
})
@Index(["projectId", "flowKey"], { unique: true })
@Index(["projectId", "sourceDataStoreId"])
export default class DataSecurityFlow extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this data flow belongs to.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this data flow belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Flow Key",
    description:
      "The flow's kind, source and destination, which identify it within the project.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public flowKey?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "What the flow is: Read, Write, AI Provider, External Host or Copy.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public kind?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "sourceDataStoreId",
    type: TableColumnType.Entity,
    modelType: DataStore,
    title: "Source Store",
    description: "Relation to the store the data comes from.",
  })
  @ManyToOne(
    () => {
      return DataStore;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "sourceDataStoreId" })
  public sourceDataStore?: DataStore = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Source Store ID",
    description: "The store the data comes from.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public sourceDataStoreId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "serviceId",
    type: TableColumnType.Entity,
    modelType: Service,
    title: "Service",
    description: "Relation to the service the data passes through.",
  })
  @ManyToOne(
    () => {
      return Service;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceId" })
  public service?: Service = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Service ID",
    description: "The service the data passes through.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "destinationDataStoreId",
    type: TableColumnType.Entity,
    modelType: DataStore,
    title: "Destination Store",
    description: "Relation to the store the data reaches.",
  })
  @ManyToOne(
    () => {
      return DataStore;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "destinationDataStoreId" })
  public destinationDataStore?: DataStore = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Destination Store ID",
    description: "The store the data reaches, for a write or a copy.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public destinationDataStoreId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Destination",
    description:
      "Where the data goes, when it is not a store: a host or an AI provider.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public destination?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Data Types",
    description: "The sensitive data types that can travel along the flow.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public dataTypeIds?: Array<string> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Sensitivity",
    description: "The sensitivity of the data that can travel along it.",
    defaultValue: "Public",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: "Public",
  })
  public sensitivity?: DataSensitivity = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Confirmed",
    description:
      "A scan found the data at the destination, not only the path to it.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isConfirmed?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Overlap Percent",
    description:
      "For a copy: how much of the source's values were found in the destination, from 0 to 100.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public overlapPercent?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Calls",
    description:
      "How many calls the service map counted along the flow in its last window.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public callCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "First Seen At",
    description: "When the flow was first seen.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstSeenAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description: "When the flow was last seen.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSeenAt?: Date = undefined;
}
