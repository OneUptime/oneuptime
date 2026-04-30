export default class UUID {
  public static generate(): string {
    return globalThis.crypto.randomUUID();
  }
}
