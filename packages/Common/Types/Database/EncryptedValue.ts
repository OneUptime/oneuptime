/*
 * HOW A VALUE KEPT ENCRYPTED AT REST BEGINS.
 *
 * DatabaseService keeps a column marked `encrypted: true` encrypted at rest
 * (Server/Utils/Encryption): every value it stores there is CryptoJS's
 * salted AES, base64, which begins with OpenSSL's "Salted__" header written
 * in base64 - this prefix. Nothing else a column holds starts with it: a
 * webhook address starts with its scheme, a community string or a token is
 * never base64 of that header. So a stored value that does not start with
 * it was written before its column was encrypted, and is read as it is
 * until its data migration encrypts it (EncryptColumnInPlace).
 *
 * In Types, not beside the cipher, because a column's own TypeORM
 * transformer has to tell a ciphertext apart too: a URL column hands one on
 * untouched (DatabaseProperty.getEncryptedDatabaseTransformer), where
 * parsing it as a URL would refuse it on its way in and read it as a broken
 * address on its way out.
 */
export const ENCRYPTED_VALUE_PREFIX: string = "U2FsdGVkX1";

// Whether `value` is a ciphertext DatabaseService stored.
export function isEncryptedValue(value: unknown): value is string {
  return (
    typeof value === "string" && value.startsWith(ENCRYPTED_VALUE_PREFIX)
  );
}
