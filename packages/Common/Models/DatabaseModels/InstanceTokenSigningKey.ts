import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import { Column, Entity } from "typeorm";

/*
 * The key this installation signs its tokens with when ENCRYPTION_SECRET is
 * unset or still a placeholder this repository ships (TokenSigningKey).
 *
 * One row: 256 bits from the CSPRNG, written by whichever OneUptime process
 * starts first (InstanceTokenSigningKeyService) and read by every other one,
 * so all of them, and every restart, sign and check with the same key. An
 * installation whose operator set ENCRYPTION_SECRET signs with that and never
 * writes this table.
 *
 * Kept as written, not encrypted: on the only installations that use it the
 * encryption key is public, so encrypting it with that would hide nothing.
 * Whoever can read this row can sign in as anybody, so it is internal and
 * root-only - there is no CRUD API - and a copy of the database is as
 * sensitive as the database itself.
 *
 * Deleting the row and restarting every app and worker makes a new key, which
 * signs everybody out.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "InstanceTokenSigningKey",
  singularName: "Instance Token Signing Key",
  pluralName: "Instance Token Signing Keys",
  icon: IconProp.Key,
  tableDescription:
    "Internal: the key this installation signs its tokens with when ENCRYPTION_SECRET is unset or a shipped placeholder.",
})
@Entity({
  name: "InstanceTokenSigningKey",
})
export default class InstanceTokenSigningKey extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Signing Key",
    description:
      "256 random bits, as 64 hexadecimal characters. Never returned by any API.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public signingKey?: string = undefined;
}
