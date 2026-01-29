import File from "./File";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import IsPermissionsIf from "../../Types/Database/IsPermissionsIf";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Version from "../../Types/Version";
import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";
import Label from "./Label";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";

export enum ProbeConnectionStatus {
  Connected = "connected",
  Disconnected = "disconnected",
}

@EnableDocumentation()
@EnableWorkflow({
  read: true,
})
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Free,
  update: PlanType.Growth,
  delete: PlanType.Free,
})
@IsPermissionsIf(Permission.Public, "projectId", null)
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/probe"))
@AccessControlColumn("labels")
@SlugifyColumn("name", "slug")
@Entity({
  name: "Probe",
})
@TableMetadata({
  tableName: "Probe",
  singularName: "Probe",
  pluralName: "Probes",
  icon: IconProp.Settings,
  tableDescription:
    "Manages custom probes. Deploy probes anywhere in the world and connect it to your project.",
})
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateProjectProbe,
  ],
  read: [
    Permission.Public,
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadProjectProbe,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteProjectProbe,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditProjectProbe,
  ],
})
export default class Probe extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectProbe,
    ],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    unique: true,
  })
  public key?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ],
    read: [Permission.Public, Permission.ReadAllProjectResources],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectProbe,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    example: "US East Coast Probe",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ],
    read: [Permission.Public, Permission.ReadAllProjectResources],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectProbe,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Name,
    example: "Monitors services from the US East Coast region",
  })
  @Column({
    nullable: true,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.Public, Permission.ReadAllProjectResources],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
    example: "us-east-coast-probe",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ],
    read: [Permission.Public, Permission.ReadAllProjectResources],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectProbe,
    ],
  })
  @TableColumn({ required: true, type: TableColumnType.Version })
  @Column({
    nullable: false,
    type: ColumnType.Version,
    length: ColumnLength.Version,
    transformer: Version.getDatabaseTransformer(),
  })
  public probeVersion?: Version = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectProbe,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastAlive?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "iconFileId",
    type: TableColumnType.Entity,
    modelType: File,
    title: "Icon",
    description: "Probe Icon",
  })
  @ManyToOne(
    () => {
      return File;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "iconFileId" })
  public iconFile?: File = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Icon",
    description: "Probe Page Icon File ID",
    canReadOnRelationQuery: true,
    example: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public iconFileId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ],
    read: [Permission.Public, Permission.ReadAllProjectResources],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: false,
    modelType: Project,
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ],
    read: [Permission.Public, Permission.ReadAllProjectResources],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Entity, modelType: User })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "d4e5f6a7-b8c9-0123-def1-234567890123",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ],
    read: [Permission.ProjectOwner, Permission.ReadAllProjectResources],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Entity, modelType: User })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ],
    read: [Permission.ProjectOwner, Permission.ReadAllProjectResources],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "e5f6a7b8-c9d0-1234-ef12-345678901234",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isGlobalProbe?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    title: "Auto Enable Probe",
    description: "Auto Enable Probe on New Monitors",
    type: TableColumnType.Boolean,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public shouldAutoEnableProbeOnNewMonitors?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    title: "Connection Status",
    description: "Connection Status of the Probe",
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    unique: false,
  })
  public connectionStatus?: ProbeConnectionStatus = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectStatusPage,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectStatusPage,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectStatusPage,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Relation to Labels Array where this object is categorized in.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "ProbeLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "probeId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;
}
