import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "AcmeCertificate",
  singularName: "Acme Certificate",
  pluralName: "Acme Certificate",
  icon: IconProp.Lock,
  tableDescription: "Lets Encrypt Certificates",
})
@Entity({
  name: "AcmeCertificate",
})
export default class AcmeCertificate extends BaseModel {
  @Index()
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.LongText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    unique: false,
  })
  public domain?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.VeryLongText })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: false,
    unique: false,
  })
  public certificate?: string = undefined;

  /*
   * The private key of the certificate Let's Encrypt issued for the domain.
   * Whoever holds it can serve the domain as its owner, so it is kept
   * encrypted at rest, as the keys customers upload for their own
   * certificates are (StatusPageDomain.customCertificateKey). The Greenlock
   * store writes it through the service, which encrypts it
   * (GreenlockUtil.orderCert, on every order and renewal), and nginx's jobs
   * read it as OneUptime through the service, which decrypts it
   * (Nginx/Jobs/AcmeWriteCertificates, WriteServerCertToDisk). The keys
   * stored before were encrypted by the EncryptLetsEncryptKeys data
   * migration; until it reaches a row, that row's key reads as itself.
   * Nobody reads it through the API (read: []).
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    secret: true,
    encrypted: true,
    type: TableColumnType.VeryLongText,
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: false,
    unique: false,
  })
  public certificateKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: false,
    unique: false,
  })
  public issuedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: false,
    unique: false,
  })
  public expiresAt?: Date = undefined;
}
