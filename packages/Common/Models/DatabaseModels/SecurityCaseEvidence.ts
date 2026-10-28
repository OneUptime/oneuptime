import File from "./File";
import Project from "./Project";
import SecurityCase from "./SecurityCase";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import SecurityCaseEvidenceKind from "../../Types/SecurityCase/SecurityCaseEvidenceKind";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Evidence kept on a security case: a file uploaded to OneUptime - a log
 * excerpt, a screenshot, a packet capture - or a link to evidence kept
 * elsewhere (SecurityCaseEvidenceKind), with what it is, who added it and
 * when.
 *
 * Kept as it was added: what a piece of evidence holds - its file or its
 * address - is written once, and OneUptime records the file's size, type
 * and the SHA-256 of its bytes as they were uploaded
 * (SecurityCaseEvidenceService), so whoever downloads it later can check it
 * is what was kept. Its name and description can be corrected. Adding
 * evidence is part of working a case, on the Member tier; removing it
 * breaks the chain of what was kept, so it takes the Admin tier, and the
 * case's timeline says who removed what. A file downloads through the
 * case's own route (SecurityCaseEvidenceAPI), for whoever can read the case.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityCaseEvidence,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateSecurityCaseEvidence,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditSecurityCaseEvidence,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteSecurityCaseEvidence,
];

// What a piece of evidence holds: written once, as it is added.
const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: [],
};

// What can be corrected: its name and description.
const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
};

// Columns only OneUptime writes: what it measured of the file.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@EnableMCP()
@EnableAuditLog({
  rootResource: { resourceType: "Security Case", column: "securityCaseId" },
})
@CanAccessIfCanReadOn("securityCase")
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/security-case-evidence"))
@OwnedThrough("securityCaseId", SecurityCase)
@Entity({
  name: "SecurityCaseEvidence",
})
@TableMetadata({
  tableName: "SecurityCaseEvidence",
  singularName: "Security Case Evidence",
  pluralName: "Security Case Evidence",
  icon: IconProp.Archive,
  tableDescription:
    "Files and links kept on a security case as evidence, each with who added it and when, and a file with the SHA-256 of what was uploaded.",
})
@Index(["securityCaseId", "createdAt"])
export default class SecurityCaseEvidence extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this evidence belongs to.",
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
    description: "ID of the project this evidence belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityCaseId",
    type: TableColumnType.Entity,
    modelType: SecurityCase,
    title: "Security Case",
    description: "The case this evidence is kept on.",
  })
  @ManyToOne(
    () => {
      return SecurityCase;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityCaseId" })
  public securityCase?: SecurityCase = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Security Case ID",
    description: "ID of the case this evidence is kept on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityCaseId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "What the evidence is: a File uploaded to OneUptime, or a Link to evidence kept somewhere else. It can't be changed.",
    example: "File",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: SecurityCaseEvidenceKind = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What the evidence is, in a few words. A file's own name when none is given.",
    example: "Proxy log for 203.0.113.7, 13:00 to 14:00 UTC",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public name?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Description",
    description:
      "What the evidence shows, and where and how it was collected.",
    example: "Exported from the web proxy by the on-call analyst.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public description?: string = undefined;

  /*
   * A File evidence's file, uploaded in the case's project (FileOwnership
   * refuses any other). Its bytes are read only through the case's
   * download route.
   */
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "fileId",
    type: TableColumnType.Entity,
    modelType: File,
    title: "File",
    description: "The uploaded file, for File evidence.",
  })
  @ManyToOne(
    () => {
      return File;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "fileId" })
  public file?: File = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "File ID",
    description:
      "ID of the uploaded file, for File evidence: upload it first, then name it here.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public fileId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.LongURL,
    canReadOnRelationQuery: true,
    title: "URL",
    description:
      "Where the evidence is kept, for Link evidence: an http or https address.",
    example: "https://edr.example.com/incidents/4821",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public url?: URL = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "File Name",
    description: "The file's name as it was uploaded, for File evidence.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public fileName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "File Type",
    description: "The file's type as it was uploaded, like text/plain.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public fileType?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    canReadOnRelationQuery: true,
    title: "File Size In Bytes",
    description: "The file's size as it was uploaded, in bytes.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public fileSizeInBytes?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "SHA-256",
    description:
      "The SHA-256 of the file's bytes as they were uploaded, in hex: compare it with a download's to check it is what was kept.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public sha256?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person who added the evidence.",
  })
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

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the person who added the evidence.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "The person who removed the evidence.",
  })
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the person who removed the evidence.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
