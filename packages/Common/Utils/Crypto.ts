import CryptoJS from "crypto-js";

export default class Crypto {
  public static getMd5Hash(text: string): string {
    return CryptoJS.MD5(text).toString();
  }

  public static getSha256Hash(text: string): string {
    return CryptoJS.SHA256(text).toString();
  }
}
