import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import { FindOperator } from "typeorm";

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
   // convert all to string, so that we can compare them
   // if the country code matches in secondary phone numbers, then pick that number
   // if no country code matches, then pick the primary phone number and return it. 

    const to: string = typeof data.to === "string" ? data.to : data.to.toString();
    const primaryPhoneNumberToPickFrom: string =
      typeof data.primaryPhoneNumberToPickFrom === "string"
        ? data.primaryPhoneNumberToPickFrom
        : data.primaryPhoneNumberToPickFrom.toString();

    const seocndaryPhoneNumbersToPickFrom: string[] = data.seocndaryPhoneNumbersToPickFrom.map(
      (phone: Phone | string) => {
        return typeof phone === "string" ? phone : phone.toString();
      },
    );

    const normalizePhoneNumber = (phone: string): string => {
      return phone.startsWith('+') ? phone.substring(1) : phone;
    };

    const toCountryCode: string = normalizePhoneNumber(to).substring(0, 3);

    const primaryPhoneNumberToPickFromCountryCode: string = normalizePhoneNumber(primaryPhoneNumberToPickFrom).substring(
      0,
      3,
    );

    if (toCountryCode === primaryPhoneNumberToPickFromCountryCode) {
      return new Phone(primaryPhoneNumberToPickFrom);
    }

    for (const secondaryPhoneNumber of seocndaryPhoneNumbersToPickFrom) {
      const secondaryPhoneNumberCountryCode: string = normalizePhoneNumber(secondaryPhoneNumber).substring(0, 3);
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
    const re: RegExp = /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,7}$/; // regex for international phone numbers format based on (ITU-T E.123)
    const isValid: boolean = re.test(v);
    if (!isValid) {
      throw new BadDataException(`Phone is not in valid format: ${v}`);
    }
    this._phone = v;
  }

  public constructor(phone: string) {
    super();
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
}
