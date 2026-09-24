import Alert from "./Alert";
import Incident from "./Incident";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnsTogether from "../../Types/Database/UniqueColumnsTogether";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Links an alert to an incident (many-to-many): one incident can carry any
 * number of alerts, and one alert can be linked to more than one incident.
 * Linking is how responders say "these alerts are part of this incident" -
 * either by linking alerts to an incident that is already open, or by
 * declaring a new incident from the alerts, which links them as it is created.
 *
 * The link belongs to the incident: its read scope follows the incident's
 * labels (CanAccessIfCanReadOn) and owners (OwnedThrough). Alert roles are
 * listed next to incident roles so a responder who works alerts can see and
 * manage the incidents their alerts were linked to; the service still checks
 * that the caller can read both the alert and the incident before linking.
 *
 * Rows are immutable - a link is created or removed, never edited - so every
 * column has an empty update list. The table keeps its update permissions
 * anyway so generated clients (Terraform) treat both ids as replace-on-change
 * instead of silently ignoring an edit.
 */
@EnableDocumentation()
@EnableMCP()
@CanAccessIfCanReadOn("incident")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.AlertAdmin,
    Permission.AlertMember,
    Permission.CreateIncidentAlert,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.IncidentViewer,
    Permission.AlertAdmin,
    Permission.AlertMember,
    Permission.AlertViewer,
    Permission.ReadIncidentAlert,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.AlertAdmin,
    Permission.AlertMember,
    Permission.DeleteIncidentAlert,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.AlertAdmin,
    Permission.AlertMember,
    Permission.EditIncidentAlert,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/incident-alert"))
@TableMetadata({
  tableName: "IncidentAlert",
  singularName: "Incident Alert",
  pluralName: "Incident Alerts",
  icon: IconProp.Link,
  tableDescription:
    "Alerts linked to an incident. Link alerts to an incident to track them as part of that incident's response.",
})
@OwnedThrough("incidentId", Incident)
@Entity({
  name: "IncidentAlert",
})
@Index(["incidentId", "alertId", "projectId"], { unique: true })
@UniqueColumnsTogether(
  ["incidentId", "alertId", "projectId"],
  "This alert is already linked to this incident.",
)
export default class IncidentAlert extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.CreateIncidentAlert,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
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
      nullable: false,
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.CreateIncidentAlert,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
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
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.CreateIncidentAlert,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description: "Relation to the Incident this alert is linked to",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentId" })
  public incident?: Incident = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.CreateIncidentAlert,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Incident ID",
    description: "ID of the Incident this alert is linked to",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.CreateIncidentAlert,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertId",
    type: TableColumnType.Entity,
    modelType: Alert,
    title: "Alert",
    description: "Relation to the Alert that is linked to the incident",
  })
  @ManyToOne(
    () => {
      return Alert;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertId" })
  public alert?: Alert = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.CreateIncidentAlert,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Alert ID",
    description: "ID of the Alert that is linked to the incident",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.CreateIncidentAlert,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Linked by User",
    description:
      "Relation to User who linked the alert to the incident (if it was linked by a User)",
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
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.CreateIncidentAlert,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Linked by User ID",
    description:
      "ID of the User who linked the alert to the incident (if it was linked by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted by User",
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadIncidentAlert,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
