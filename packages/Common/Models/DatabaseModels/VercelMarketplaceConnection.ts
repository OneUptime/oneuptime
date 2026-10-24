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
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index } from "typeorm";

/*
 * A Vercel project connected to a OneUptime resource (see
 * ee/Server/CloudMarketplace/Vercel/VercelMarketplaceMonitors).
 *
 * A team connects its Vercel projects to a OneUptime resource in the Vercel
 * dashboard, which gives each project the resource's environment variables.
 * Vercel tells OneUptime with a webhook, naming the project and its
 * production domain, and OneUptime watches that domain with a website
 * monitor in the resource's project - shown on the resource's status page -
 * unless the resource was set not to. This row remembers which monitor is
 * the project's, so a second webhook does not make a second one and
 * disconnecting the project deletes the right one.
 *
 * The OneUptime project is a plain ID, not a relation, like
 * MarketplaceSubscription's: the rows of a deleted project are deleted with
 * it by the code that deletes it.
 *
 * SaaS only (billing enabled). Master-admin only.
 */
@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/vercel-marketplace-connection"))
@TableMetadata({
  tableName: "VercelMarketplaceConnection",
  singularName: "Vercel Marketplace Connection",
  pluralName: "Vercel Marketplace Connections",
  icon: IconProp.Link,
  tableDescription:
    "Vercel projects connected to a OneUptime resource from Vercel Marketplace, and the monitor that watches each one's production domain.",
})
@Entity({
  name: "VercelMarketplaceConnection",
})
@Index(["marketplaceSubscriptionId", "vercelProjectId"], { unique: true })
export default class VercelMarketplaceConnection extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ObjectID,
    title: "Marketplace Subscription ID",
    description:
      "The resource the Vercel project is connected to: its marketplace purchase.",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    nullable: false,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public marketplaceSubscriptionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "The OneUptime project of the resource.",
    example: "5f8b9c0d-e1f2-3a4b-5c6d-7e8f9a0b1c2d",
  })
  @Column({
    nullable: false,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Vercel Project ID",
    description: "The connected Vercel project.",
    example: "prj_ndlgr43fadlPyCtREAqxxdyFK",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public vercelProjectId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Vercel Project Name",
    description: "The Vercel project's name, as Vercel last gave it.",
    example: "storefront",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public vercelProjectName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Production Domain",
    description:
      "The Vercel project's production domain, which the monitor checks. Empty until the project has one.",
    example: "storefront.vercel.app",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public productionDomain?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Monitor ID",
    description:
      "The website monitor OneUptime made for the production domain, if it made one.",
    example: "b1c2d3e4-f5a6-7890-abcd-ef1234567890",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorId?: ObjectID = undefined;
}
