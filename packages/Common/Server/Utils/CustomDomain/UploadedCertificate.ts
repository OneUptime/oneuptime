import BadDataException from "../../../Types/Exception/BadDataException";
import crypto from "crypto";

/*
 * A CERTIFICATE A CUSTOMER UPLOADS FOR THEIR OWN DOMAIN, AND ITS PRIVATE KEY.
 *
 * A status page's, a dashboard's or a form's custom domain can be served
 * with a certificate its owner uploads instead of the free one OneUptime
 * orders (isCustomCertificate, customCertificate, customCertificateKey on
 * StatusPageDomain, DashboardDomain and FormDomain). nginx serves the pair
 * as it is (Nginx/Jobs/WriteCustomCertsToDisk), so a pair it cannot use
 * leaves the domain without a working certificate - and since the key is
 * never shown again once it is saved (it is write-only, and encrypted at
 * rest), whoever uploaded it could not tell what went wrong.
 *
 * So the pair is checked whenever a write makes the domain serve one: on a
 * create with the switch on, and on an update that turns the switch on or
 * writes either half while it is on - the half the update does not write
 * read from the row. The pair must be:
 *
 *   - both there;
 *   - a certificate in PEM (the first one of a chain is the domain's own);
 *   - a private key in PEM, without a passphrase - nginx cannot type one;
 *   - the key the certificate was issued for.
 *
 * Each refusal says which half is wrong and how to fix it, in words that
 * never quote what was pasted. Nothing here logs either half.
 */

export const UPLOADED_CERTIFICATE_MISSING_MESSAGE: string =
  "To serve your own certificate, add both the certificate and its private key.";

export const UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE: string =
  "The certificate could not be read. Paste it in PEM format, starting with -----BEGIN CERTIFICATE-----.";

export const UPLOADED_KEY_UNREADABLE_MESSAGE: string =
  "The private key could not be read. Paste it in PEM format, starting with -----BEGIN PRIVATE KEY-----.";

export const UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE: string =
  "The private key is protected by a passphrase. Paste it without one: the server has to read it to serve the certificate.";

export const UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE: string =
  "The private key does not belong to this certificate. Paste the private key the certificate was issued for.";

// Every refusal above, for the dialog that shows them under their field.
export const UPLOADED_CERTIFICATE_REFUSALS: ReadonlyArray<string> = [
  UPLOADED_CERTIFICATE_MISSING_MESSAGE,
  UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE,
  UPLOADED_KEY_UNREADABLE_MESSAGE,
  UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE,
  UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE,
];

// What a domain's write and row hold of an uploaded certificate.
export interface UploadedCertificateColumns {
  isCustomCertificate?: boolean | null | undefined;
  customCertificate?: string | null | undefined;
  customCertificateKey?: string | null | undefined;
}

// The select that reads them, for a hook that reads the rows an update writes.
export const UPLOADED_CERTIFICATE_SELECT: {
  isCustomCertificate: true;
  customCertificate: true;
  customCertificateKey: true;
} = {
  isCustomCertificate: true,
  customCertificate: true,
  customCertificateKey: true,
};

/*
 * A key in PEM that only a passphrase opens: PKCS #8's encrypted form, or
 * the traditional one's "Proc-Type: 4,ENCRYPTED" header.
 */
const ENCRYPTED_KEY_MARKERS: ReadonlyArray<string> = [
  "-----BEGIN ENCRYPTED PRIVATE KEY-----",
  "Proc-Type: 4,ENCRYPTED",
];

// What OpenSSL answers when a key it was handed needs a passphrase.
const PASSPHRASE_ERROR_CODES: ReadonlyArray<string> = [
  "ERR_MISSING_PASSPHRASE",
  "ERR_OSSL_CRYPTO_INTERRUPTED_OR_CANCELLED",
  "ERR_OSSL_BAD_DECRYPT",
];

const readText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

export default class UploadedCertificate {
  /*
   * Throws, with what to do, unless the certificate and key make a pair
   * nginx can serve (see above). Both are read as they will be stored:
   * trimmed (normalize).
   */
  public static assertServable(data: {
    certificate: unknown;
    privateKey: unknown;
  }): void {
    const certificateText: string = readText(data.certificate);
    const privateKeyText: string = readText(data.privateKey);

    if (!certificateText || !privateKeyText) {
      throw new BadDataException(UPLOADED_CERTIFICATE_MISSING_MESSAGE);
    }

    let certificate: crypto.X509Certificate;

    try {
      // A chain's first certificate is the domain's own.
      certificate = new crypto.X509Certificate(certificateText);
    } catch {
      throw new BadDataException(UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE);
    }

    if (
      ENCRYPTED_KEY_MARKERS.some((marker: string): boolean => {
        return privateKeyText.includes(marker);
      })
    ) {
      throw new BadDataException(UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE);
    }

    let privateKey: crypto.KeyObject;

    try {
      privateKey = crypto.createPrivateKey({
        key: privateKeyText,
        format: "pem",
      });
    } catch (err) {
      const code: unknown = (err as { code?: unknown } | null)?.code;

      if (typeof code === "string" && PASSPHRASE_ERROR_CODES.includes(code)) {
        throw new BadDataException(UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE);
      }

      throw new BadDataException(UPLOADED_KEY_UNREADABLE_MESSAGE);
    }

    let isPair: boolean = false;

    try {
      isPair = certificate.checkPrivateKey(privateKey);
    } catch {
      isPair = false;
    }

    if (!isPair) {
      throw new BadDataException(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE);
    }
  }

  /*
   * A write's certificate and key as they are stored: without the blank
   * lines and spaces a paste picks up around them, which nginx would trip
   * over at the start of the file. A value a write does not set is left
   * alone.
   */
  public static normalize(data: UploadedCertificateColumns): void {
    if (typeof data.customCertificate === "string") {
      data.customCertificate = data.customCertificate.trim();
    }

    if (typeof data.customCertificateKey === "string") {
      data.customCertificateKey = data.customCertificateKey.trim();
    }
  }

  /*
   * A new domain that serves its own certificate brings a pair that works.
   * One on the free certificate is not asked about whatever else it sends.
   */
  public static assertCreateIsServable(data: UploadedCertificateColumns): void {
    UploadedCertificate.normalize(data);

    if (!data.isCustomCertificate) {
      return;
    }

    UploadedCertificate.assertServable({
      certificate: data.customCertificate,
      privateKey: data.customCertificateKey,
    });
  }

  /*
   * Whether an update writes anything that decides the certificate a
   * domain serves: the switch, the certificate or its key.
   */
  public static isWrittenBy(data: UploadedCertificateColumns): boolean {
    return (
      data.isCustomCertificate !== undefined ||
      data.customCertificate !== undefined ||
      data.customCertificateKey !== undefined
    );
  }

  /*
   * An update leaves every domain it writes with a pair that works, when it
   * serves its own certificate after the update: the switch as the update
   * sets it, else as the row has it, and each half as the update writes it,
   * else as the row keeps it - a renewed certificate with the key already
   * saved, say, which the edit form leaves blank as it never shows the key.
   * The rows are read (readRows: the service's findRowsAndHoldUpdateToThem)
   * only when the update writes one of the three and does not turn the
   * switch off.
   */
  public static async assertUpdateIsServable(data: {
    data: UploadedCertificateColumns;
    readRows: () => Promise<Array<UploadedCertificateColumns>>;
  }): Promise<void> {
    UploadedCertificate.normalize(data.data);

    if (
      !UploadedCertificate.isWrittenBy(data.data) ||
      data.data.isCustomCertificate === false ||
      data.data.isCustomCertificate === null
    ) {
      return;
    }

    for (const row of await data.readRows()) {
      const isCustomCertificate: boolean = Boolean(
        data.data.isCustomCertificate !== undefined
          ? data.data.isCustomCertificate
          : row.isCustomCertificate,
      );

      if (!isCustomCertificate) {
        continue;
      }

      UploadedCertificate.assertServable({
        certificate:
          data.data.customCertificate !== undefined
            ? data.data.customCertificate
            : row.customCertificate,
        privateKey:
          data.data.customCertificateKey !== undefined
            ? data.data.customCertificateKey
            : row.customCertificateKey,
      });
    }
  }
}
