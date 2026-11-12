import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * What one person chose for themselves in one project (issue #6814): today,
 * the products they pinned to the nav bar, beside Home and Products
 * (Types/Product/ProductPins).
 *
 * One row per project and person, held so by the unique index below:
 * ProjectProductsService writes it with INSERT ... ON CONFLICT DO UPDATE,
 * so two tabs pinning at once never leave two rows. It is deleted with its
 * project or its user.
 *
 * Kept on the server, not in the browser, so the pins follow the person to
 * another browser and device. A row of its own rather than a column on
 * Project or TeamMember: a person may be in several teams of a project, and
 * Project is read on nearly every request, by every member.
 *
 * Nobody reads or writes it through the API: the person's own pins come
 * with the products answer (GET /project-products, ProjectProductsAPI),
 * and they change them through POST /project-products/pins, which only ever
 * touches the caller's own row. Nobody else's pins are ever sent.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/project-user-preference"))
@TableMetadata({
  tableName: "ProjectUserPreference",
  singularName: "Project User Preference",
  pluralName: "Project User Preferences",
  icon: IconProp.User,
  tableDescription:
    "What a person chose for themselves in a project, such as the products they pinned to the nav bar. Only they see it.",
})
/*
 * One row per person in a project. Also how every read finds a person's row
 * (projectId leads), so the table needs no other index.
 */
@Index(["projectId", "userId"], { unique: true })
@Entity({
  name: "ProjectUserPreference",
})
export default class ProjectUserPreference extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "The project these choices are for.",
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
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project these choices are for.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "The person who made these choices.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of the person who made these choices.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Pinned Products",
    description:
      "The products this person pinned to the nav bar in this project, in the order they were pinned, by their product keys (at most five).",
    example: '["monitors", "logs"]',
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    unique: false,
  })
  public pinnedProducts?: Array<string> = undefined;
}
