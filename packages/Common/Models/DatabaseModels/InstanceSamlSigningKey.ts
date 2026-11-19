import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import { Column, Entity } from "typeorm";

/*
 * The key pair this installation signs its SAML messages with, as a SAML
 * service provider (#9603): the LogoutRequest that signs a person out of
 * their identity provider too, and the LogoutResponse to an identity
 * provider's own sign-out request. Okta, AD FS and Keycloak with "Client
 * signature required" refuse an unsigned one, and check it against the
 * certificate an admin gave them.
 *
 * One row: an RSA key and a self-signed certificate for it, made by
 * whichever OneUptime process needs them first (InstanceSamlSigningKeyService)
 * and read by every other one, so every process, and every restart, signs
 * with the key whose certificate the identity providers hold. Every project's
 * and the instance's SAML providers share it, as they share the server.
 *
 * The private key is kept encrypted with ENCRYPTION_SECRET, like the server's
 * other secrets; the certificate is public - anyone may download it
 * (GET /identity/saml-signing-certificate). Internal and root-only: there is
 * no CRUD API.
 *
 * Deleting the row makes a new key pair at the next SAML sign-out, and every
 * identity provider has to be given the new certificate.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "InstanceSamlSigningKey",
  singularName: "Instance SAML Signing Key",
  pluralName: "Instance SAML Signing Keys",
  icon: IconProp.Key,
  tableDescription:
    "Internal: the key pair this installation signs its SAML sign-out messages with.",
})
@Entity({
  name: "InstanceSamlSigningKey",
})
export default class InstanceSamlSigningKey extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    encrypted: true,
    type: TableColumnType.VeryLongText,
    title: "Private Key",
    description:
      "The RSA private key, PKCS#8 PEM, encrypted at rest. Never returned by any API.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public privateKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    title: "Certificate",
    description:
      "The self-signed X.509 certificate of the key, PEM: what identity providers check OneUptime's SAML messages against.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public certificate?: string = undefined;
}
