import Hostname from "./API/Hostname";
import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import { FindOperator } from "typeorm";
import Zod, { ZodSchema } from "../Utils/Schema/Zod";

const nonBusinessEmailDomains: Array<string> = [
  "gmail",
  "yahoo",
  "yahoomail",
  "googlemail",
  "ymail",
  "icloud",
  "aol",
  "hotmail",
  "outlook",
  "msn",
  "wanadoo",
  "orange",
  "comcast",
  "facebook",
  "hey.com",
  "protonmail",
  "inbox.com",
  "mail.com",
  "zoho",
  "yandex",
];

export default class Email extends DatabaseProperty {
  private _email: string = "";
  public get email(): string {
    return this._email;
  }
  public set email(value: string) {
    if (value && typeof value === "string") {
      value = value.trim();
      value = value.toLowerCase();
    }

    if (Email.isValid(value)) {
      this._email = value;
    } else {
      throw new BadDataException(`Email ${value} is not in valid format.`);
    }
  }

  public constructor(email: string) {
    super();
    this.email = email;
  }

  public static isValid(value: string): boolean {
    // from https://datatracker.ietf.org/doc/html/rfc5322

    const re: RegExp =
      /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/i;
    const isValid: boolean = re.test(value);
    if (!isValid) {
      return false;
    }
    return true;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Email,
      value: (this as Email).toString(),
    };
  }

  public static fromString(value: string): Email {
    return new Email(value);
  }

  public static override fromJSON(json: JSONObject): Email {
    if (json["_type"] === ObjectType.Email) {
      return new Email((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public override toString(): string {
    return this.email;
  }

  public getEmailDomain(): Hostname {
    return new Hostname(this.email!.split("@")[1]!);
  }

  public isBusinessEmail(): boolean {
    const domain: string = this.getEmailDomain().hostname || "";
    if (domain) {
      for (let i: number = 0; i < nonBusinessEmailDomains.length; i++) {
        if (domain.includes(nonBusinessEmailDomains[i]!)) {
          return false;
        }
      }
    }

    return true;
  }

  public static override toDatabase(
    value: Email | FindOperator<Email>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new Email(value);
      }

      return value.toString();
    }

    return null;
  }

  public static override fromDatabase(_value: string): Email | null {
    if (_value) {
      return new Email(_value);
    }

    return null;
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.Email),
      value: Zod.string().email().openapi({
        type: "string",
        format: "email",
        example: "user@example.com",
      }),
    }).openapi({
      type: "object",
      description: "Email object",
      example: { _type: ObjectType.Email, value: "user@example.com" },
    });
  }
}
