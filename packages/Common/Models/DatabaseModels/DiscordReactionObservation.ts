import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Project from "./Project";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import UniqueColumnsTogether from "../../Types/Database/UniqueColumnsTogether";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

export type DiscordObservationState = "Pending" | "Done";

/*
 * Durable proof that one Discord reaction or pin was already processed into
 * a note. Redis claims are the first dedupe layer, but they expire and vanish
 * on a cache flush; without this row, a poll after a Redis loss would
 * re-process a reaction whose note someone deliberately deleted in
 * OneUptime. See DiscordReactionNoteSync / DiscordPinNoteSync.
 *
 * Rows are written Pending BEFORE any note save or user reply (claim), and
 * flipped to Done after the terminal side effect (markDone). A crash in
 * between leaves an explicit ambiguous state that a later run steals, not a
 * silent success.
 *
 * Internal table: no CRUD API, no workflows, root access only.
 */
@Entity({
  name: "DiscordReactionObservation",
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@Index(["projectId", "claimKey"], { unique: true })
@UniqueColumnsTogether(
  ["projectId", "claimKey"],
  "This reaction was already processed.",
)
@TableMetadata({
  tableName: "DiscordReactionObservation",
  singularName: "Discord Reaction Observation",
  pluralName: "Discord Reaction Observations",
  icon: IconProp.Logs,
  tableDescription:
    "Processed Discord reactions and pins, for durable deduplication",
})
class DiscordReactionObservation extends BaseModel {
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

  /*
   * The full claim key: resourceId:noteType:channelId:messageId:reactorId.
   * Unique per project, which the composite index below enforces.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Claim Key",
    description:
      "Durable dedupe key of the processed reaction or pin: resourceId:noteType:channelId:messageId:actorId",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.Description,
    nullable: false,
  })
  public claimKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Source",
    description: "What produced this observation: reaction or native pin",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.Name,
    nullable: false,
  })
  public source?: "reaction" | "pin" = undefined;

  /*
   * When this claim was taken (or last stolen). The generation token for
   * claim ownership: markDone/release match it, so a stale worker cannot
   * terminate a claim a fresh worker holds. Also the staleness clock for
   * stealing abandoned Pending rows.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Observed At",
    description:
      "When this claim was taken or stolen; the claim ownership token.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public observedAt?: Date = undefined;

  /*
   * Pending = claimed, side effect (note save / user reply) not yet durably
   * recorded as complete. Done = terminal. A crash between claim and
   * markDone leaves Pending; a later run steals it after the stale
   * threshold.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Observation State",
    description:
      "Pending: claimed, not yet complete. Done: processed into a note or refusal.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.Name,
    nullable: false,
  })
  public observationState?: DiscordObservationState = undefined;
}

export default DiscordReactionObservation;
