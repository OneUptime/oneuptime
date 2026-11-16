import { translationKey } from "../Translator";

/*
 * WHY A CUSTOM DOMAIN'S UPLOADED CERTIFICATE WAS NOT SAVED.
 *
 * A status page's, a dashboard's or a form's custom domain can serve a
 * certificate its owner uploads, with its private key. Every save that
 * makes the domain serve one checks the pair (Server/Utils/CustomDomain/
 * UploadedCertificate) and refuses one nginx could not serve in one of
 * these English sentences: an API client, the CLI and Terraform read them
 * as they are. None quotes what was pasted.
 *
 * The Edit dialog says each under the half it is about (Field
 * .ownsServerError), in the reader's language: each is a key of the
 * Dashboard's locales (this file is a "keys" root of its string extractor),
 * which the field's error line looks up (FieldError). Read with indexOf,
 * never a pattern: they are the server's words.
 *
 * React-free and server-safe: the server throws these, the Dashboard reads
 * them.
 */

export const UPLOADED_CERTIFICATE_MISSING_MESSAGE: string = translationKey(
  "To serve your own certificate, add both the certificate and its private key.",
);

export const UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE: string = translationKey(
  "The certificate could not be read. Paste it in PEM format, starting with -----BEGIN CERTIFICATE-----.",
);

export const UPLOADED_KEY_UNREADABLE_MESSAGE: string = translationKey(
  "The private key could not be read. Paste it in PEM format, starting with -----BEGIN PRIVATE KEY-----.",
);

export const UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE: string = translationKey(
  "The private key is protected by a passphrase. Paste it without one: the server has to read it to serve the certificate.",
);

export const UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE: string = translationKey(
  "The private key does not belong to this certificate. Paste the private key the certificate was issued for.",
);

// Every refusal above, for the dialog that shows them under their field.
export const UPLOADED_CERTIFICATE_REFUSALS: ReadonlyArray<string> = [
  UPLOADED_CERTIFICATE_MISSING_MESSAGE,
  UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE,
  UPLOADED_KEY_UNREADABLE_MESSAGE,
  UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE,
  UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE,
];

// The refusals about the certificate: the half the dialog shows as stored.
export const UPLOADED_CERTIFICATE_HALF_REFUSALS: ReadonlyArray<string> = [
  UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE,
];

/*
 * The refusals about the private key. A missing half is the key too: the
 * dialog never saves a domain on its own certificate without one (its
 * Certificate is required then, and shows what is stored), and the key is
 * the half that is never shown again, so it is the one that can be missing
 * unseen - a domain switched to its own certificate before the key was
 * asked for, say.
 */
export const UPLOADED_KEY_HALF_REFUSALS: ReadonlyArray<string> = [
  UPLOADED_CERTIFICATE_MISSING_MESSAGE,
  UPLOADED_KEY_UNREADABLE_MESSAGE,
  UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE,
  UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE,
];

const isOneOf: (message: string, refusals: ReadonlyArray<string>) => boolean = (
  message: string,
  refusals: ReadonlyArray<string>,
): boolean => {
  return refusals.some((refusal: string): boolean => {
    return message.indexOf(refusal) !== -1;
  });
};

// Whether the server refused the save because of the certificate.
export const isUploadedCertificateRefusal: (message: string) => boolean = (
  message: string,
): boolean => {
  return isOneOf(message, UPLOADED_CERTIFICATE_HALF_REFUSALS);
};

// Whether the server refused the save because of the private key.
export const isUploadedKeyRefusal: (message: string) => boolean = (
  message: string,
): boolean => {
  return isOneOf(message, UPLOADED_KEY_HALF_REFUSALS);
};
