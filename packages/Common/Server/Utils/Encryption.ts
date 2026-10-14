import { EncryptionSecret } from "../EnvironmentConfig";
import CryptoJS from "crypto-js";
import CaptureSpan from "./Telemetry/CaptureSpan";

export default class Encryption {
  /*
   * How every value this class produces begins. CryptoJS.AES.encrypt with a
   * string passphrase writes OpenSSL's "Salted__" + salt header, which
   * base64-encodes to this prefix. Nothing but our own ciphertext starts
   * with it, so a stored value that does not is plaintext that predates a
   * column being encrypted — a row written before the column was made a
   * secret, waiting for its backfill — and decrypt must hand it back
   * untouched rather than turn it to garbage. See looksEncrypted.
   */
  public static readonly CIPHERTEXT_PREFIX: string = "U2FsdGVkX1";

  /*
   * Whether `value` is ciphertext this class wrote. A column freshly made
   * encrypted still holds legacy plaintext until its backfill runs, and in
   * the window before it does every read of the column passes through here;
   * a value that is not our ciphertext is returned as it is, so the read
   * neither throws ("Malformed UTF-8 data") nor yields an empty string.
   */
  public static looksEncrypted(value: string): boolean {
    return (
      typeof value === "string" &&
      value.startsWith(Encryption.CIPHERTEXT_PREFIX)
    );
  }

  @CaptureSpan()
  public static async encrypt(text: string): Promise<string> {
    if (!text) {
      return "";
    }

    const secret: string = await this.getEncryptionSecret();
    const encryptedText: string = CryptoJS.AES.encrypt(text, secret).toString();
    return encryptedText;
  }

  @CaptureSpan()
  public static async decrypt(encryptedText: string): Promise<string> {
    if (!encryptedText) {
      return "";
    }

    const secret: string = await this.getEncryptionSecret();
    const decryptedText: string = CryptoJS.AES.decrypt(
      encryptedText,
      secret,
    ).toString(CryptoJS.enc.Utf8);
    return decryptedText;
  }

  private static async getEncryptionSecret(): Promise<string> {
    const encryptionKey: string = EncryptionSecret.toString();
    return CryptoJS.SHA256(encryptionKey).toString();
  }
}
