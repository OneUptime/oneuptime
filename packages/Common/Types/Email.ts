import Hostname from "./API/Hostname";
import DatabaseProperty from "./Database/DatabaseProperty";
import Domain from "./Domain";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, JSONValue, ObjectType } from "./JSON";
import { FindOperator } from "typeorm";
import Zod, { ZodSchema } from "../Utils/Schema/Zod";
import { refusedValue } from "../Utils/RefusedValue";

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

/*
 * The longest address worth looking at. RFC 5321 fits a local part of up to
 * 64 characters and a domain of up to 253 into 254, so nothing longer is a
 * mailbox. The length is checked before any pattern runs, so the work of
 * reading a value stays tied to how long one real address can be, never to
 * how long a caller made the string.
 */
export const MAX_EMAIL_ADDRESS_LENGTH: number = 254;

/*
 * One mailbox, as RFC 5322 writes it: a dot-atom local part (or a quoted
 * one), an "@", and a domain of dotted labels or a bracketed address literal.
 *
 * The pattern is anchored at both ends, so the WHOLE value has to be a single
 * address. A list ("a@example.com, b@example.com"), a display name with an
 * address ("Alice <a@example.com>"), a group ("team: a@example.com"), or any
 * leading or trailing text is therefore not one mailbox and is refused -
 * rather than read as whichever address sits inside it, which is what a mail
 * sender would then deliver to.
 *
 * Every repeated part stops before the character that ends it - a label
 * before its dot, the local part before the "@" - and the bracketed literal
 * is a single bounded run, so the value is read once from left to right and
 * the time to read it stays in line with its length whatever it holds.
 */
const ONE_EMAIL_ADDRESS: RegExp =
  // eslint-disable-next-line no-control-regex
  /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[[a-z0-9:._-]{1,64}\])$/i;

export default class Email extends DatabaseProperty {
  private _email: string = "";
  public get email(): string {
    return this._email;
  }
  public set email(value: string) {
    /*
     * An Email handed in where its text is expected - a copy, or the address
     * local storage gives back as an Email - is read by its text, which is
     * checked below like any other. Nothing else that is not text (a list,
     * an object from JSON) is read as the text it would turn into.
     */
    if ((value as unknown) instanceof Email) {
      value = (value as unknown as Email).toString();
    }

    if (value && typeof value === "string") {
      value = value.trim();
      value = value.toLowerCase();
    }

    if (Email.isValid(value)) {
      this._email = value;
      this._isMalformed = false;
    } else {
      throw new BadDataException(
        `Email ${refusedValue(value)} is not in valid format.`,
      );
    }
  }

  /*
   * Set only by the lenient read paths (fromDatabase / fromJSON) when a stored
   * value is not one valid mailbox. Such an Email keeps its raw string so it
   * still round-trips and still renders, but toDatabase refuses it, so a value
   * that is not a single address can never be written back or newly created -
   * only a value already stored before this check existed can carry the flag.
   * This mirrors how URL keeps a legacy value it can no longer parse.
   */
  private _isMalformed: boolean = false;
  public isMalformed(): boolean {
    return this._isMalformed;
  }

  public constructor(email: string) {
    super();
    this.email = email;
  }

  public static isValid(value: string): boolean {
    // from https://datatracker.ietf.org/doc/html/rfc5322

    /*
     * Only text is an address: a list or an object handed in from JSON is
     * not read as the text it would turn into.
     */
    if (
      typeof value !== "string" ||
      !value ||
      value.length > MAX_EMAIL_ADDRESS_LENGTH
    ) {
      return false;
    }

    return ONE_EMAIL_ADDRESS.test(value);
  }

  /*
   * A read-only path: builds an Email from a value already stored, holding it
   * as-is when it is not one valid mailbox, so a single legacy row cannot fail
   * the whole query that reads it. Writes stay strict - see toDatabase. A
   * stored address is always text, so anything else is refused here as it
   * always was.
   */
  private static fromStoredValueLenient(value: unknown): Email {
    if (typeof value !== "string") {
      throw new BadDataException(
        `Email ${refusedValue(value)} is not in valid format.`,
      );
    }

    const trimmed: string = value.trim().toLowerCase();

    if (Email.isValid(trimmed)) {
      return new Email(trimmed);
    }

    const email: Email = new Email("placeholder@oneuptime.invalid");
    email._email = trimmed;
    email._isMalformed = true;
    return email;
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

  public static parseList(value: string | null | undefined): Array<Email> {
    if (!value) {
      return [];
    }

    const seen: Set<string> = new Set<string>();
    const emails: Array<Email> = [];

    for (const part of value.split(/[,;\s]+/)) {
      const trimmed: string = part.trim();
      if (!trimmed) {
        continue;
      }
      const email: Email = new Email(trimmed);
      const key: string = email.toString();
      if (!seen.has(key)) {
        seen.add(key);
        emails.push(email);
      }
    }

    return emails;
  }

  public static isValidList(value: string | null | undefined): boolean {
    if (!value) {
      return true;
    }

    const parts: Array<string> = value
      .split(/[,;\s]+/)
      .map((p: string): string => {
        return p.trim();
      })
      .filter((p: string): boolean => {
        return p.length > 0;
      });

    if (parts.length === 0) {
      return false;
    }

    for (const part of parts) {
      if (!Email.isValid(part)) {
        return false;
      }
    }
    return true;
  }

  public static override fromJSON(json: JSONObject): Email {
    if (json["_type"] === ObjectType.Email) {
      const value: JSONValue | undefined = json["value"];

      /*
       * No value, an empty one, or one that is not text was never an
       * address, and is refused as before.
       */
      if (typeof value !== "string" || !value.trim()) {
        throw new BadDataException(
          `Email ${refusedValue(value ?? "")} is not in valid format.`,
        );
      }

      /*
       * Lenient for the same reason fromDatabase is: this is how a stored
       * value crosses the wire into the browser. A value that was accepted
       * before this check existed must still render; the write paths stay
       * strict, so nothing invalid can be newly stored through here.
       */
      return Email.fromStoredValueLenient(value);
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

  /*
   * Whether a value is an address on a name RFC 2606 reserves for testing
   * (Domain.isReservedName): a test's or an example's address, never a
   * person's. Reads any value, an address or not, and never throws.
   */
  public static isOnReservedDomain(value: string): boolean {
    if (typeof value !== "string") {
      return false;
    }

    const at: number = value.lastIndexOf("@");

    if (at < 0) {
      return false;
    }

    return Domain.isReservedName(value.slice(at + 1));
  }

  public static override toDatabase(
    value: Email | FindOperator<Email>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new Email(value);
      }

      /*
       * The write side stays strict. Reads tolerate a value stored before the
       * one-mailbox check, but nothing may persist one: refusing a malformed
       * value here stops it being written back on an unrelated update, and
       * stops a client inventing one. A malformed Email only ever comes from
       * fromDatabase / fromJSON.
       */
      if (value instanceof Email && value.isMalformed()) {
        throw new BadDataException(
          `Email ${refusedValue(value.toString())} is not in valid format.`,
        );
      }

      return value.toString();
    }

    return null;
  }

  public static override fromDatabase(_value: string): Email | null {
    /*
     * The database transformer's from can be handed a value already read as
     * an Email (Email.test.ts pins it): it reads by its text, as stored -
     * one that is not one mailbox stays malformed.
     */
    if ((_value as unknown) instanceof Email) {
      _value = (_value as unknown as Email).toString();
    }

    // Nothing but spaces is no address: it reads as no value at all.
    if (_value && (typeof _value !== "string" || _value.trim())) {
      return Email.fromStoredValueLenient(_value);
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
