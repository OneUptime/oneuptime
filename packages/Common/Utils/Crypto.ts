/*
 * The two hashes this class gives, not crypto-js's index: a public dashboard
 * reaches it through its metric charts (Utils/Telemetry/EntityKey), and the
 * index brings every cipher and hash crypto-js has (HashedString says what
 * that weighs).
 */
import MD5 from "crypto-js/md5";
import SHA256 from "crypto-js/sha256";

export default class Crypto {
  public static getMd5Hash(text: string): string {
    return MD5(text).toString();
  }

  public static getSha256Hash(text: string): string {
    return SHA256(text).toString();
  }
}
