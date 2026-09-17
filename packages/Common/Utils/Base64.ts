class Base64 {
  public static base64UrlToUint8Array(base64Url: string): Uint8Array {
    const base64: string = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64") as Uint8Array;
  }

  public static uint8ArrayToBase64Url(uint8Array: Uint8Array): string {
    const base64: string = Buffer.from(uint8Array).toString("base64");
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/[=]/g, "");
  }
}

export default Base64;
