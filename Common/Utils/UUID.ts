import { randomUUID } from "crypto";

export default class UUID {
  public static generate(): string {
    return randomUUID();
  }
}
