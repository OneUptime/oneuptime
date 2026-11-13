import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import { ProductFeedbackKind } from "../../Types/ProductFeedback/ProductFeedback";
import { Column, Entity, Index } from "typeorm";

/*
 * WHAT PEOPLE TOLD ONEUPTIME (issue #6832): one row per answer - "How easy
 * was that?" at the end of a guided setup, Give feedback, "Was this clear?"
 * under an explanation, the first-week check-in.
 *
 * Kept on this server, and read by its master admins only (Admin Dashboard
 * > Feedback, through the master-admin routes of ProductFeedbackAPI). It
 * has no CRUD API: ProductFeedbackService writes it as root, from the
 * routes' own checks, so every column's access is empty.
 *
 * A row names nobody: no person, no project, no address. It holds the
 * answer, the page as a route pattern with no ids and the product version
 * (Types/ProductFeedback/ProductFeedback, readProductFeedbackSubmission),
 * and when it was given (createdAt).
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "ProductFeedback",
  singularName: "Product Feedback",
  pluralName: "Product Feedback",
  icon: IconProp.Chat,
  tableDescription:
    "What people told OneUptime about how it went: the question at the end of a guided setup, Give feedback, Was this clear? and the first-week check-in.",
})
@Entity({
  name: "ProductFeedback",
})
@Index(["kind", "createdAt"])
export default class ProductFeedback extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(ProductFeedbackKind),
    title: "Kind",
    description:
      "How the answer was given: setup_flow (the end of a guided setup), general (Give feedback), explanation (Was this clear?) or check_in (the first-week check-in).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: ProductFeedbackKind = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Topic",
    description:
      "What the answer is about, as the code names it: the guided setup (website_down), the explanation (how_oneuptime_works, term.criteria), first_week or help.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public topic?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.SmallPositiveNumber,
    title: "Score",
    description:
      "How easy it was, from 1 (very hard) to 5 (very easy). Only for the question at the end of a guided setup.",
  })
  @Column({
    nullable: true,
    type: ColumnType.SmallPositiveNumber,
  })
  public score?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Is Positive",
    description:
      "Thumbs up on Was this clear?, or Yes to the first-week check-in; false for thumbs down or Not yet.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isPositive?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Details",
    description:
      "What the person wrote, if anything: what got in the way, or what they were trying to do and what happened.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public details?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Page",
    description:
      "The page the answer was given on, as a route with no ids: /dashboard/:projectId/monitors/:id.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public page?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Product Version",
    description: "The OneUptime version the answer was given on.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public productVersion?: string = undefined;
}
