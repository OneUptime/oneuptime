import AIRun from "./AIRun";
import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { InvestigationRecording } from "../../Types/AI/InvestigationRecording";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * What an AI investigation saw (issue #6800): the context it started from
 * and every tool call it made with the text it was handed back
 * (Types/AI/InvestigationRecording), so the run can be replayed on the same
 * data after a prompt or model change (Server/Utils/AI/Eval/
 * ReplayInvestigation). One row per completed investigation run that kept
 * one; deleted with its run, and after
 * INVESTIGATION_RECORDING_RETENTION_IN_DAYS (AIRunRecordingService).
 *
 * The text holds telemetry the tools read as the system - more than a
 * project member may read through the run's activity - so the table is
 * written and read only by the server: no client can read or write a row,
 * and it has no CRUD API.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Entity({
  name: "AIRunRecording",
})
@TableMetadata({
  tableName: "AIRunRecording",
  singularName: "AI Run Recording",
  pluralName: "AI Run Recordings",
  icon: IconProp.Bolt,
  tableDescription:
    "Internal record of what an AI investigation saw, kept for a limited time so it can be run again on the same data after a prompt or model change.",
})
export default class AIRunRecording extends BaseModel {
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
    create: [],
    read: [],
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
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: true,
    modelType: AIRun,
    manyToOneRelationColumn: "aiRunId",
    title: "AI Run",
    description: "The investigation run this recording belongs to.",
  })
  @ManyToOne(
    () => {
      return AIRun;
    },
    {
      cascade: false,
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "aiRunId" })
  public aiRun?: AIRun = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "AI Run ID",
    description: "ID of the investigation run this recording belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiRunId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Recording",
    description:
      "The context the investigation started from, and every tool call it made with what it was handed back.",
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
  })
  public recording?: InvestigationRecording = undefined;
}
