import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/InstanceSamlSigningKey";
import Encryption from "../Utils/Encryption";
import SelfSignedCertificate, {
  SelfSignedKeyPair,
} from "../Utils/SelfSignedCertificate";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import crypto from "crypto";

/*
 * The one row of InstanceSamlSigningKey. A fixed id, so "store a key pair
 * unless one is stored" is a primary-key conflict Postgres settles by itself.
 */
export const INSTANCE_SAML_SIGNING_KEY_ROW_ID: string =
  ObjectID.getZeroObjectID().toString();

// Who the certificate says it is: issuer and subject alike.
export const SAML_SIGNING_CERTIFICATE_COMMON_NAME: string =
  "OneUptime SAML Service Provider";

/*
 * How long the certificate is valid: twenty years, so no identity provider
 * has to be given a new one. Identity providers pin the certificate itself,
 * and a sign-out request signed with a key nobody else holds needs nothing
 * more.
 */
export const SAML_SIGNING_CERTIFICATE_VALID_FOR_DAYS: number = 20 * 365;

/*
 * Started a day early, so an identity provider whose clock is behind the
 * server's still takes it the day it is made.
 */
const CERTIFICATE_BACKDATE_IN_MS: number = 24 * 60 * 60 * 1000;

export const UNUSABLE_SAML_SIGNING_KEY_MESSAGE: string =
  "The InstanceSamlSigningKey table holds no usable SAML signing key, so OneUptime cannot sign people out of SAML identity providers. Delete its row and restart every OneUptime app to make a new key pair, then give every SAML identity provider the new signing certificate.";

export class Service extends DatabaseService<Model> {
  // The key pair, once read: it never changes while a process runs.
  private keyPair: SelfSignedKeyPair | null = null;

  // A read in flight, shared by every caller that asks meanwhile.
  private keyPairOnItsWay: Promise<SelfSignedKeyPair> | null = null;

  public constructor() {
    super(Model);
  }

  /*
   * This installation's SAML signing key and its certificate, made by
   * whichever process asked first.
   *
   * Read first, so a process that finds them stored makes no key. When none
   * is, a new key pair is offered with "insert unless one is stored", and
   * then the stored one is read: a statement of its own, it sees a row
   * another process committed while the insert waited on it. So any number
   * of processes asking at once all come away with the same key pair, and a
   * restart reads the one it had.
   *
   * Throws when the stored row holds no usable key pair - a damaged or
   * hand-edited row, or one encrypted with another ENCRYPTION_SECRET -
   * rather than sign with whatever it holds.
   */
  @CaptureSpan()
  public async getKeyPair(): Promise<SelfSignedKeyPair> {
    if (this.keyPair) {
      return this.keyPair;
    }

    if (!this.keyPairOnItsWay) {
      this.keyPairOnItsWay = this.readOrCreateKeyPair()
        .then((keyPair: SelfSignedKeyPair): SelfSignedKeyPair => {
          this.keyPair = keyPair;
          return keyPair;
        })
        .finally((): void => {
          this.keyPairOnItsWay = null;
        });
    }

    return await this.keyPairOnItsWay;
  }

  // The certificate alone: public, for anyone to download.
  @CaptureSpan()
  public async getCertificate(): Promise<string> {
    return (await this.getKeyPair()).certificate;
  }

  // Forgets the key pair read. For tests.
  public forgetKeyPairForTests(): void {
    this.keyPair = null;
    this.keyPairOnItsWay = null;
  }

  private async readOrCreateKeyPair(): Promise<SelfSignedKeyPair> {
    const stored: SelfSignedKeyPair | null = await this.readStoredKeyPair();

    if (stored) {
      return stored;
    }

    const made: SelfSignedKeyPair = await SelfSignedCertificate.create({
      commonName: SAML_SIGNING_CERTIFICATE_COMMON_NAME,
      notBefore: new Date(Date.now() - CERTIFICATE_BACKDATE_IN_MS),
      validForDays: SAML_SIGNING_CERTIFICATE_VALID_FOR_DAYS,
    });

    await this.getRepository().manager.query(
      `INSERT INTO "InstanceSamlSigningKey" ("_id", "privateKey", "certificate", "version")
        VALUES ($1, $2, $3, 1)
        ON CONFLICT ("_id") DO NOTHING`,
      [
        INSTANCE_SAML_SIGNING_KEY_ROW_ID,
        await Encryption.encrypt(made.privateKey),
        made.certificate,
      ],
    );

    const afterInsert: SelfSignedKeyPair | null =
      await this.readStoredKeyPair();

    if (!afterInsert) {
      throw new Error(UNUSABLE_SAML_SIGNING_KEY_MESSAGE);
    }

    return afterInsert;
  }

  /*
   * The stored key pair, or null when no row is stored. Throws when the row
   * holds a key that does not read, or a certificate that is not of it.
   */
  private async readStoredKeyPair(): Promise<SelfSignedKeyPair | null> {
    const rows: Array<{ privateKey?: unknown; certificate?: unknown }> =
      await this.getRepository().manager.query(
        `SELECT "privateKey", "certificate" FROM "InstanceSamlSigningKey" WHERE "_id" = $1`,
        [INSTANCE_SAML_SIGNING_KEY_ROW_ID],
      );

    const row: { privateKey?: unknown; certificate?: unknown } | undefined =
      rows?.[0];

    if (!row) {
      return null;
    }

    if (
      typeof row.privateKey !== "string" ||
      typeof row.certificate !== "string"
    ) {
      throw new Error(UNUSABLE_SAML_SIGNING_KEY_MESSAGE);
    }

    let privateKey: string;

    try {
      privateKey = Encryption.looksEncrypted(row.privateKey)
        ? await Encryption.decrypt(row.privateKey)
        : row.privateKey;
    } catch {
      throw new Error(UNUSABLE_SAML_SIGNING_KEY_MESSAGE);
    }

    if (!Service.isKeyPair({ privateKey, certificate: row.certificate })) {
      throw new Error(UNUSABLE_SAML_SIGNING_KEY_MESSAGE);
    }

    return { privateKey, certificate: row.certificate };
  }

  // Whether the certificate is one of the private key's own public key.
  private static isKeyPair(keyPair: SelfSignedKeyPair): boolean {
    try {
      return new crypto.X509Certificate(keyPair.certificate).checkPrivateKey(
        crypto.createPrivateKey(keyPair.privateKey),
      );
    } catch {
      return false;
    }
  }
}

export default new Service();
