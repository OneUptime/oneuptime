import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import { FindOperator } from "typeorm/find-options/FindOperator";
import Zod, { ZodSchema } from "../Utils/Schema/Zod";

export default class Domain extends DatabaseProperty {
  private _domain: string = "";
  public get domain(): string {
    return this._domain;
  }
  public set domain(v: string) {
    const isValid: boolean = Domain.isValidDomain(v);
    if (!isValid) {
      throw new BadDataException("Domain " + v + " is not in valid format.");
    }
    this._domain = v;
  }

  public static isValidDomain(domain: string): boolean {
    // Regex-based domain validation
    // - Each label (part between dots) must be 1-63 characters
    // - Labels can contain alphanumeric characters and hyphens
    // - Labels cannot start or end with a hyphen
    // - TLD must be at least 2 characters and contain only letters
    // - Total length should not exceed 253 characters

    if (!domain || domain.length > 253) {
      return false;
    }

    // Domain validation regex:
    // ^                                          - start of string
    // (?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+  - one or more labels followed by dot
    // [a-zA-Z]{2,63}                             - TLD: 2-63 letters only
    // $                                          - end of string
    const domainRegex: RegExp =
      /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

    return domainRegex.test(domain);
  }

  public constructor(domain: string) {
    super();
    this.domain = domain;
  }

  public override toString(): string {
    return this.domain;
  }

  protected static override toDatabase(
    value: Domain | FindOperator<Domain>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new Domain(value);
      }

      return value.toString();
    }

    return null;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Domain,
      value: (this as Domain).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): Domain {
    if (json["_type"] === ObjectType.Domain) {
      return new Domain((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  protected static override fromDatabase(_value: string): Domain | null {
    if (_value) {
      return new Domain(_value);
    }

    return null;
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.Domain),
      value: Zod.string().openapi({
        type: "string",
        example: "example.com",
      }),
    }).openapi({
      type: "object",
      description: "Domain object",
      example: { _type: ObjectType.Domain, value: "example.com" },
    });
  }
}
