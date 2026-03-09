import { v4 as uuidv4 } from "uuid";

export default class UUID {
  public static generate(): string {
    return uuidv4();
  }
}
