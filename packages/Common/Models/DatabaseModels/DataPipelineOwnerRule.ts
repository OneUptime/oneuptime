import Project from "./Project";
import Team from "./Team";
import User from "./User";
import RuleBaseModel from "./DatabaseBaseModel/RuleBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

/*
 * WHO OWNS A PIPELINE, NAMED BY A RULE (#9527).
 *
 * A pipeline's owners hear of its failed and late runs (#6551), and every
 * pipeline used to need them set by hand. A rule names them for every
 * pipeline it matches, by the pipeline's name and its namespace - where it
 * runs, as its OpenLineage events say - when OneUptime first sees the
 * pipeline (DataPipelineOwnerRuleEngineService), and Run Now adds them to
 * the pipelines it already knows. A pipeline has no labels, so a rule
 * matches on its name and namespace alone.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.TelemetryAdmin,
    Permission.TelemetryMember,
    Permission.CreateDataPipelineOwnerRule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.TelemetryAdmin,
    Permission.TelemetryMember,
    Permission.TelemetryViewer,
    Permission.ReadDataPipelineOwnerRule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.TelemetryAdmin,
    Permission.TelemetryMember,
    Permission.DeleteDataPipelineOwnerRule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.TelemetryAdmin,
    Permission.TelemetryMember,
    Permission.EditDataPipelineOwnerRule,
  ],
})
@CrudApiEndpoint(new Route("/data-pipeline-owner-rule"))
@Entity({
  name: "DataPipelineOwnerRule",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "DataPipelineOwnerRule",
  singularName: "Pipeline Owner Rule",
  pluralName: "Pipeline Owner Rules",
  icon: IconProp.User,
  tableDescription:
    "Rules for automatically assigning owners to data pipelines when matching pipelines are first seen.",
})
export default class DataPipelineOwnerRule extends RuleBaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
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

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.EditDataPipelineOwnerRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this rule",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.EditDataPipelineOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this rule",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.EditDataPipelineOwnerRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Whether this rule is enabled",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.EditDataPipelineOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Notify Owners",
    description:
      "Send notifications to owner users and teams when they are added by this rule.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public notifyOwners?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.EditDataPipelineOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Pipeline Name",
    description:
      "Case-insensitive regex matched against the pipeline's name, such as orders_daily.load_orders.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public nameRegexPattern?: string = undefined;

  /*
   * Where the pipeline runs, as its OpenLineage namespace says it:
   * airflow://prod, dbt://warehouse, fivetran://acme. A team that runs its
   * own Airflow is matched by its namespace alone.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.EditDataPipelineOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Namespace",
    description:
      "Case-insensitive regex matched against the pipeline's namespace: where it runs, such as airflow://prod.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public namespaceRegexPattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.EditDataPipelineOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: User,
    title: "Owner Users",
    description:
      "Users to add as owners on the resource when this rule matches.",
  })
  @ManyToMany(
    () => {
      return User;
    },
    { eager: false },
  )
  @JoinTable({
    name: "DataPipelineOwnerRuleUser",
    inverseJoinColumn: {
      name: "userId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "dataPipelineOwnerRuleId",
      referencedColumnName: "_id",
    },
  })
  public ownerUsers?: Array<User> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.EditDataPipelineOwnerRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Owner Teams",
    description:
      "Teams to add as owners on the resource when this rule matches.",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "DataPipelineOwnerRuleTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "dataPipelineOwnerRuleId",
      referencedColumnName: "_id",
    },
  })
  public ownerTeams?: Array<Team> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.CreateDataPipelineOwnerRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataPipelineOwnerRule,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
