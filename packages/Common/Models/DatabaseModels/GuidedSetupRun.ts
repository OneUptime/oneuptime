import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE PERSON'S PASS THROUGH ONE GUIDED SETUP IN ONE PROJECT (#7253): the ids
 * of the records it made, a few answers, and how each record it makes is
 * getting on (Types/GuidedSetup/GuidedSetupRun.ts says what each holds).
 *
 * Kept on the server, not in the browser, so another device, a private
 * window or a reload opens the setup at the step the person was on, with
 * what it made, failed or is making in its panel.
 *
 * One row per project, person and setup, held so by the unique index below:
 * GuidedSetupRunService makes a change under a lock on that row, so two
 * devices saving at once both keep what they saved. Nobody reads or writes
 * it through the API: GuidedSetupRunAPI's routes take no person and only
 * ever touch the caller's own run. It is deleted with its project or its
 * person, when the person starts the setup afresh, and by the daily purge
 * once nobody has changed it for 30 days; the records it made stay.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "GuidedSetupRun",
  singularName: "Guided Setup Run",
  pluralName: "Guided Setup Runs",
  icon: IconProp.RocketLaunch,
  tableDescription:
    "One person's progress through a guided setup in a project: the records it made and how each is getting on. Only they see it.",
})
/*
 * One row per person and setup in a project. Also how every read and write
 * finds the row (projectId leads), so the table needs no other index.
 */
@Index(["projectId", "userId", "setup"], { unique: true })
@Entity({
  name: "GuidedSetupRun",
})
export default class GuidedSetupRun extends BaseModel {
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
    description: "The project the setup is run in.",
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
    description: "ID of the project the setup is run in.",
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
    description: "The person running the setup.",
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
    description: "ID of the person running the setup.",
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
    required: true,
    type: TableColumnType.ShortText,
    title: "Setup",
    description:
      "Which guided setup this is: website_down, on_call, status_page or telemetry.",
    example: "website_down",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public setup?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Values",
    description:
      "What the run knows besides its records, by name: the ids of what it made, a few answers, and what the person typed.",
    example: '{"monitorId": "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e"}',
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    unique: false,
  })
  public values?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Resources",
    description:
      "How each record the setup makes is getting on, by name: being made, made, failed and why, or skipped.",
    example:
      '{"monitor": {"status": "created", "recordId": "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e", "at": "2026-11-20T10:00:00.000Z"}}',
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    unique: false,
  })
  public resources?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Revision",
    description:
      "How many changes the run has kept: a device holding an older revision holds an older run.",
    example: "3",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public revision?: number = undefined;
}
