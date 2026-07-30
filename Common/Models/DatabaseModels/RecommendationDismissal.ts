import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One recommendation a project has decided it does not want, on one resource.
 *
 * Recommendations themselves are computed, not stored: the catalog derives them
 * from telemetry every time the page loads. That makes "no thanks" the only
 * piece of state worth persisting, and it has to be persisted — a dismissal
 * held in React state comes back on the next page load, and a dismissal held in
 * localStorage comes back for the next engineer on the team. Both make the
 * recommendation list something people learn to ignore.
 *
 * The row is deliberately NOT scoped to a monitor or to any other created
 * object. It is scoped to (recommendationType, resourceType, resourceId,
 * recommendationId), which is enough to answer "hide this card here" for every
 * present and future recommendation kind. `resourceId` is a plain ObjectID
 * column with no relation because the resource it points at is polymorphic —
 * a KubernetesCluster, a Host, a DockerHost and five others, with no shared
 * parent table to point a foreign key at. The cost of that is orphan rows when
 * a resource is deleted; they are a handful of bytes each, they are invisible
 * (nothing queries them once the resource is gone), and the alternative is
 * eight nullable FK columns.
 *
 * Un-dismissing is a DELETE, not a flag. Deletes in this codebase are hard
 * deletes (see DatabaseService._deleteBy), so a re-dismissal after a restore
 * is a clean insert and the `@UniqueColumnBy` guard below stays accurate.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateRecommendationDismissal,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadRecommendationDismissal,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteRecommendationDismissal,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditRecommendationDismissal,
  ],
})
@CrudApiEndpoint(new Route("/recommendation-dismissal"))
@TableMetadata({
  tableName: "RecommendationDismissal",
  singularName: "Recommendation Dismissal",
  pluralName: "Recommendation Dismissals",
  icon: IconProp.EyeSlash,
  tableDescription:
    "Recommendations your team has dismissed. Dismissing hides a recommendation for everyone on the project until it is restored; it never deletes anything that was already created from it.",
})
@Entity({
  name: "RecommendationDismissal",
})
/*
 * Every read is "give me the dismissals for this one resource", which is
 * exactly this index. It is deliberately not unique — uniqueness is enforced
 * at the application layer by `@UniqueColumnBy` below, which (unlike a Postgres
 * unique index) treats a NULL `resourceId` as a value rather than as "always
 * distinct". A future project-wide recommendation kind will have no resourceId,
 * and it still must not be dismissable twice.
 */
@Index(["projectId", "recommendationType", "resourceType", "resourceId"])
export default class RecommendationDismissal extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateRecommendationDismissal,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
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
      Permission.ProjectMember,
      Permission.CreateRecommendationDismissal,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
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
      Permission.CreateRecommendationDismissal,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Recommendation Type",
    description:
      "Which family of recommendation this dismissal belongs to. See the RecommendationType enum.",
    example: "Monitor",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public recommendationType?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateRecommendationDismissal,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Recommendation ID",
    description:
      "The catalog-wide id of the dismissed recommendation, for example Kubernetes:k8s-hpa-at-max-replicas.",
    example: "Kubernetes:k8s-hpa-at-max-replicas",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  /*
   * Application-level uniqueness. A second dismissal of the same
   * recommendation on the same resource is always a double click or a stale
   * tab, never something the user meant.
   */
  @UniqueColumnBy([
    "projectId",
    "recommendationType",
    "resourceType",
    "resourceId",
  ])
  public recommendationId?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateRecommendationDismissal,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Resource Type",
    description:
      "The kind of resource this recommendation was shown on, for example Kubernetes or Docker. Empty for recommendations that are not scoped to a resource.",
    example: "Kubernetes",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public resourceType?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateRecommendationDismissal,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Resource ID",
    description:
      "ID of the resource this recommendation was shown on. Polymorphic — it points at whichever table Resource Type names — so it carries no foreign key.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public resourceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateRecommendationDismissal,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditRecommendationDismissal,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Dismissal Reason",
    description:
      "Optional note explaining why this recommendation was dismissed, shown to whoever finds it in the dismissed list later.",
    example: "We alert on this from Prometheus already.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public dismissalReason?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateRecommendationDismissal,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
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
      Permission.ProjectMember,
      Permission.CreateRecommendationDismissal,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
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

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadRecommendationDismissal,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
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
      Permission.ReadRecommendationDismissal,
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
