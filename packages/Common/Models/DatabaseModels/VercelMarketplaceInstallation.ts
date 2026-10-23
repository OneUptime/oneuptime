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
import VercelInstallationStatus from "../../Types/Marketplace/VercelInstallationStatus";
import { Column, Entity, Index } from "typeorm";

/*
 * OneUptime installed on a Vercel team, from Vercel Marketplace (see
 * ee/Server/CloudMarketplace/Vercel).
 *
 * Vercel tells OneUptime about an installation when a team adds the
 * integration (Upsert Installation), and gives it an access token that never
 * expires: the token OneUptime calls Vercel's marketplace API with to send
 * usage and invoices, update a resource's secrets and look up the team's
 * projects. A team has one installation; uninstalling and installing again
 * makes a new one, with a new ID.
 *
 * Each resource the team adds is a OneUptime project, billed through Vercel:
 * a MarketplaceSubscription (marketplace Vercel) whose externalCustomerId is
 * this installation's ID. This row is what the resources share - the token,
 * the team's name and contact, and where its invoices stand.
 *
 * SaaS only (billing enabled). Master-admin only, like
 * MarketplaceSubscription; the access token is encrypted at rest and never
 * returned by the API.
 */
@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/vercel-marketplace-installation"))
@TableMetadata({
  tableName: "VercelMarketplaceInstallation",
  singularName: "Vercel Marketplace Installation",
  pluralName: "Vercel Marketplace Installations",
  icon: IconProp.Billing,
  tableDescription:
    "Vercel teams that installed OneUptime from Vercel Marketplace, and the access token OneUptime calls Vercel with for them.",
})
@Entity({
  name: "VercelMarketplaceInstallation",
})
export default class VercelMarketplaceInstallation extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index({ unique: true })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Installation ID",
    description:
      "Vercel's ID of the installation (icfg_...). A reinstall gets a new one.",
    example: "icfg_7BsYazjxsiKpsDTXiAUcOJmP",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public installationId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Vercel Account ID",
    description: "The Vercel team (account) that installed OneUptime.",
    example: "team_LLHUOMOoDlqOp8wPE4kFo9pE",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public vercelAccountId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Access Token",
    description:
      "The token Vercel gave OneUptime for this installation, which calls Vercel's marketplace API. Encrypted at rest and never returned by the API.",
    hideColumnInDocumentation: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public accessToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Token Type",
    description: "The access token's type, as Vercel gave it (Bearer).",
    example: "Bearer",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public tokenType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Scopes",
    description:
      "The Vercel API scopes the team granted the integration, such as read:project.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public scopes?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Accepted Policies",
    description:
      "The policies the team accepted while installing (terms of service, privacy policy...), with when.",
    example: { toc: "2026-10-18T10:00:00Z" },
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public acceptedPolicies?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Account Name",
    description: "The Vercel team's name.",
    example: "Acme",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public accountName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Account URL",
    description: "The installation in the Vercel dashboard.",
    example: "https://vercel.com/acme/~/integrations/oneuptime",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public accountUrl?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Email,
    title: "Contact Email",
    description: "Who Vercel names as the team's contact for the installation.",
    example: "owner@acme.com",
  })
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
  })
  public contactEmail?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Contact Name",
    description: "The contact's name, where Vercel gives one.",
    example: "Ada Lovelace",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public contactName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description:
      "Active, DeletePending (uninstalled; the final invoice is still to be sent) or Deleted.",
    example: "Active",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: VercelInstallationStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Delete Requested At",
    description: "When Vercel asked OneUptime to delete the installation.",
    example: "2026-10-18T10:00:00.000Z",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public deleteRequestedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Invoiced Until",
    description:
      "The end of the last period OneUptime sent Vercel an invoice for. The next invoice starts here.",
    example: "2026-10-01T00:00:00.000Z",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public invoicedUntil?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Billing Data Sent At",
    description:
      "When OneUptime last sent Vercel the running totals of the current period.",
    example: "2026-10-18T10:10:00.000Z",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public billingDataSentAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Last Billing Error",
    description:
      "Why Vercel last refused, or could not be sent, this installation's usage or invoice. Empty once one goes through.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public lastBillingError?: string = undefined;
}
