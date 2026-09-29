import { EncryptionSecret } from "../EnvironmentConfig";
import CryptoJS from "crypto-js";
import CaptureSpan from "./Telemetry/CaptureSpan";

export default class Encryption {
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
