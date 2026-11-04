/*
 * THE FORMATS A COLUMN IS USUALLY HELD TO.
 *
 * A Format Mismatch check takes a regular expression; these are the ones most
 * columns want, so nobody has to write them. Each is written in the plain
 * syntax every engine's regular expressions share.
 */

export enum DataCheckFormat {
  Email = "Email",
  Uuid = "UUID",
  CountryCode = "Country Code",
  Url = "URL",
  IpAddress = "IP Address",
  IsoDate = "ISO Date",
  PhoneNumber = "Phone Number",
  Custom = "Custom",
}

export const DATA_CHECK_FORMAT_PATTERNS: Readonly<
  Partial<Record<DataCheckFormat, string>>
> = {
  [DataCheckFormat.Email]: "^[^@ ]+@[^@ ]+[.][^@ ]+$",
  [DataCheckFormat.Uuid]:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
  [DataCheckFormat.CountryCode]: "^[A-Z]{2}$",
  [DataCheckFormat.Url]: "^https?://[^ ]+$",
  [DataCheckFormat.IpAddress]: "^[0-9]{1,3}([.][0-9]{1,3}){3}$",
  [DataCheckFormat.IsoDate]: "^[0-9]{4}-[0-9]{2}-[0-9]{2}",
  [DataCheckFormat.PhoneNumber]: "^[+]?[0-9 ()-]{7,20}$",
};

export const DATA_CHECK_FORMATS: ReadonlyArray<DataCheckFormat> =
  Object.values(DataCheckFormat);

// The pattern a format stands for; a custom format has the one the person writes.
export function getFormatPattern(
  format: string | null | undefined,
): string | null {
  return DATA_CHECK_FORMAT_PATTERNS[format as DataCheckFormat] || null;
}

// The format a Data Security data type should look like, when it has one.
const FORMAT_OF_DATA_TYPE: Readonly<Record<string, DataCheckFormat>> = {
  "email-address": DataCheckFormat.Email,
  "phone-number": DataCheckFormat.PhoneNumber,
  "ip-address": DataCheckFormat.IpAddress,
};

export function getFormatOfDataType(
  dataTypeId: string,
): DataCheckFormat | null {
  return FORMAT_OF_DATA_TYPE[dataTypeId] || null;
}
