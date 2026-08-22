import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index } from "typeorm";

/*
 * Internal table (no API access) recording server-confirmed conversions —
 * signups, booked meetings, enterprise licence requests and paid subscriptions
 * — together with the attribution the converting visitor carried (ad click
 * IDs, UTM parameters, first touch) and the status of uploading them to ad
 * platforms. Browser analytics never write this table: rows are written by the
 * Cal.com webhook, the enterprise licence request endpoint and the
 * MarketingConversions worker job, which also reads it.
 *
 * Two things this table deliberately is not. It is not a CRM: contact, account
 * and deal records live in Revenue, and nothing here creates or advances them.
 * And it is not a lead inbox: the name, company and message a person types
 * into the enterprise form are emailed to sales and never stored here, because
 * every column in this table is a candidate for forwarding to an ad platform.
 */
@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/marketing-conversion"))
@TableMetadata({
  tableName: "MarketingConversion",
  singularName: "Marketing Conversion",
  pluralName: "Marketing Conversions",
  icon: IconProp.ChartBar,
  tableDescription:
    "Server-confirmed conversions (signups, meetings booked, enterprise licence requests, paid subscriptions), the campaign attribution each carried, and their upload status to ad platforms for offline conversion tracking.",
})
@Entity({
  name: "MarketingConversion",
})
/*
 * One conversion of each type per user/project. Postgres treats NULLs as
 * distinct, so these indexes only constrain rows that actually carry a user or
 * project id — conversion types with neither (a booked meeting from an
 * anonymous visitor) are de-duplicated by their deterministic primary key
 * instead.
 */
@Index("uq_marketing_conversion_type_user", ["conversionType", "userId"], {
  unique: true,
})
@Index(
  "uq_marketing_conversion_type_project",
  ["conversionType", "projectId"],
  {
    unique: true,
  },
)
export default class MarketingConversion extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Conversion Type",
    description:
      "SignUp, MeetingBooked, EnterpriseLicenseRequested or PaidSubscription.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public conversionType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_marketing_conversion_user_id")
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "User ID",
    description:
      "User this conversion belongs to (SignUp conversions). Null when the conversion has no OneUptime user yet, as with a booked meeting.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_marketing_conversion_project_id")
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Project ID",
    description:
      "Project this conversion belongs to (PaidSubscription conversions).",
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
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Email",
    description:
      "Email of the converting user. Never sent anywhere in the clear: every ad platform receives the SHA-256 in emailHash instead.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public email?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: true,
    title: "Click IDs",
    description:
      "Ad click identifiers (gclid, wbraid, gbraid, fbclid, ...) captured for this conversion.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
  })
  public clickIds?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    title: "Conversion At",
    description: "When the conversion happened.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public conversionAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Conversion Value (USD Cents)",
    description:
      "Conversion value in USD cents (monthly recurring revenue for paid subscriptions). Null when unknown (custom pricing) or not applicable (signups, booked meetings).",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public conversionValueInUSDCents?: number | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Upload State",
    description:
      "Per-ad-platform upload state, keyed by provider (google, meta, microsoft, linkedin, reddit, ...): { status: Uploaded|Failed|Skipped, attempts, error, uploadedAt }. Absent key or absent status means pending.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public uploadState?: JSONObject = undefined;

  /*
   * Last-touch UTM parameters, copied from the User or Project this conversion
   * belongs to, or read from Cal booking metadata for a booked meeting.
   *
   * The ledger carried only clickIds until now, which meant the only thing
   * that could answer "how many demos did this campaign produce" was the ad
   * platform, and only for clicks it had auto-tagged. Any campaign delivering
   * UTMs without a click id — a newsletter, a sponsorship, a conference link —
   * was invisible in OneUptime's own data. These columns are what make the
   * ledger reportable on its own.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_marketing_conversion_utm_campaign")
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "UTM Campaign",
    description: "Last-touch utm_campaign for this conversion.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public utmCampaign?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_marketing_conversion_utm_source")
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "UTM Source",
    description: "Last-touch utm_source for this conversion.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public utmSource?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "UTM Medium",
    description: "Last-touch utm_medium for this conversion.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public utmMedium?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "UTM Term",
    description: "Last-touch utm_term for this conversion.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public utmTerm?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "UTM Content",
    description: "Last-touch utm_content for this conversion.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public utmContent?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "UTM URL",
    description:
      "Landing URL of the attributed visit. The only attribution a campaign leaves when its link carried a click id and no UTMs at all, as Google Ads auto-tagging does.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public utmUrl?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "First Touch Attribution",
    description:
      "UTM parameters, click IDs, landing URL and referrer from the visitor's first attributed visit. The utm* columns above hold last-touch values.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public firstTouchAttribution?: JSONObject | undefined = undefined;

  /*
   * SHA-256 of the lowercased, trimmed email (Common/Server/Utils/Attribution).
   *
   * Two jobs, and it is the same value for both. Ad platforms that support
   * enhanced matching want exactly this digest, and it is the only key that
   * can join a booked meeting to the signup it produced weeks later: a
   * MeetingBooked row has no userId, a SignUp row has no booking, and the
   * person may well have used a different device for each. Indexed because
   * the chain-linking pass looks conversions up by it.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_marketing_conversion_email_hash")
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Email Hash",
    description:
      "SHA-256 of the normalized (trimmed, lowercased) email. Used for ad-platform enhanced matching and to join conversions by the same person across the demo/signup boundary.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public emailHash?: string | undefined = undefined;

  /*
   * The earlier conversion by the same person that this one followed.
   *
   * Set by the MarketingConversions worker, never by a writer: the writers see
   * one moment each and cannot know what came before it. A paid subscription
   * pointing at a booked meeting is what makes "revenue this demo campaign
   * produced" answerable — without it the ledger holds four unrelated rows for
   * one customer journey.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_marketing_conversion_attributed_to")
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Attributed To Conversion ID",
    description:
      "The earliest earlier conversion by the same person (matched on emailHash) that this conversion followed. Null when this is the first conversion in the chain.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public attributedToConversionId?: ObjectID | undefined = undefined;
}
