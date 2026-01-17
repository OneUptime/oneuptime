import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import { FindOperator } from "typeorm";
import Zod, { ZodSchema } from "../Utils/Schema/Zod";

export default class Phone extends DatabaseProperty {
  private _phone: string = "";
  public get phone(): string {
    return this._phone;
  }

  public static pickPhoneNumberToSendSMSOrCallFrom(data: {
    to: Phone | string;
    primaryPhoneNumberToPickFrom: Phone | string;
    seocndaryPhoneNumbersToPickFrom: Phone[] | string[];
  }): Phone {
    /*
     * convert all to string, so that we can compare them
     * if the country code matches in secondary phone numbers, then pick that number
     * if no country code matches, then pick the primary phone number and return it.
     */

    const to: string =
      typeof data.to === "string" ? data.to : data.to.toString();
    const primaryPhoneNumberToPickFrom: string =
      typeof data.primaryPhoneNumberToPickFrom === "string"
        ? data.primaryPhoneNumberToPickFrom
        : data.primaryPhoneNumberToPickFrom.toString();

    const seocndaryPhoneNumbersToPickFrom: string[] =
      data.seocndaryPhoneNumbersToPickFrom.map((phone: Phone | string) => {
        return typeof phone === "string" ? phone : phone.toString();
      });

    type NormalizePhoneNumberFunction = (phone: string) => string;

    const normalizePhoneNumber: NormalizePhoneNumberFunction = (
      phone: string,
    ): string => {
      phone = phone.trim();
      return phone.startsWith("+") ? phone.substring(1) : phone;
    };

    const toCountryCode: string = normalizePhoneNumber(to).substring(0, 2);

    const primaryPhoneNumberToPickFromCountryCode: string =
      normalizePhoneNumber(primaryPhoneNumberToPickFrom).substring(0, 2);

    if (toCountryCode === primaryPhoneNumberToPickFromCountryCode) {
      return new Phone(primaryPhoneNumberToPickFrom);
    }

    for (const secondaryPhoneNumber of seocndaryPhoneNumbersToPickFrom) {
      const secondaryPhoneNumberCountryCode: string = normalizePhoneNumber(
        secondaryPhoneNumber,
      ).substring(0, 2);
      if (toCountryCode === secondaryPhoneNumberCountryCode) {
        return new Phone(secondaryPhoneNumber);
      }
    }

    return new Phone(primaryPhoneNumberToPickFrom);
  }

  public set phone(v: string) {
    /*
     * TODO: Have a valid regex for phone.
     * const re: RegExp =
     *     /^(([^<>()[\].,;:\s@"]+(.[^<>()[\].,;:\s@"]+)*)|(".+"))@(([^<>()[\].,;:\s@"]+.)+[^<>()[\].,;:\s@"]{2,})$/i;
     * const isValid: boolean = re.test(v);
     * if (!isValid) {
     *     throw new BadDataException('Phone is not in valid format.');
     * }
     */

    v = v.trim();

    const re: RegExp = /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,7}$/; // regex for international phone numbers format based on (ITU-T E.123)
    const isValid: boolean = re.test(v);
    if (!isValid) {
      throw new BadDataException(`Phone is not in valid format: ${v}`);
    }
    this._phone = v;
  }

  public constructor(phone: string | Phone) {
    super();

    if (phone instanceof Phone) {
      phone = phone.phone;
    }

    this.phone = phone;
  }

  public override toString(): string {
    return this.phone;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Phone,
      value: (this as Phone).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): Phone {
    if (json["_type"] === ObjectType.Phone) {
      return new Phone((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  protected static override toDatabase(
    value: Phone | FindOperator<Phone>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new Phone(value);
      }

      return value.toString();
    }

    return null;
  }

  protected static override fromDatabase(_value: string): Phone | null {
    if (_value) {
      return new Phone(_value);
    }

    return null;
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.Phone),
      value: Zod.string().openapi({
        type: "string",
        example: "+1-555-123-4567",
      }),
    }).openapi({
      type: "object",
      description: "Phone object",
      example: { _type: ObjectType.Phone, value: "+1-555-123-4567" },
    });
  }

  // Map of calling code prefixes to ISO country codes
  private static readonly CALLING_CODE_TO_COUNTRY_MAP: Record<string, string> = {
    "+1": "US", // US and Canada
    "+44": "GB", // United Kingdom
    "+61": "AU", // Australia
    "+49": "DE", // Germany
    "+33": "FR", // France
    "+91": "IN", // India
    "+81": "JP", // Japan
    "+86": "CN", // China
    "+55": "BR", // Brazil
    "+52": "MX", // Mexico
  };

  /**
   * Extract ISO country code from a phone number
   * @param phoneNumber - The phone number (e.g., "+15551234567")
   * @returns ISO country code (e.g., "US") or "US" as default
   */
  public static getCountryCodeFromPhoneNumber(phoneNumber: string): string {
    for (const [prefix, countryCode] of Object.entries(
      Phone.CALLING_CODE_TO_COUNTRY_MAP,
    )) {
      if (phoneNumber.startsWith(prefix)) {
        return countryCode;
      }
    }
    return "US"; // Default to US if unknown
  }

  /**
   * Extract area code from a phone number
   * Currently only supports US/Canada (+1) numbers
   * @param phoneNumber - The phone number (e.g., "+15551234567")
   * @returns Area code (e.g., "555") or empty string for non-US/CA numbers
   */
  public static getAreaCodeFromPhoneNumber(phoneNumber: string): string {
    // For US/Canada numbers (+1), extract the next 3 digits
    if (phoneNumber.startsWith("+1")) {
      const number: string = phoneNumber.substring(2);
      if (number.length >= 3) {
        return number.substring(0, 3);
      }
    }
    // For other countries, area code extraction is more complex
    return "";
  }
}
