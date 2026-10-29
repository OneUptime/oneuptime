import { describe, expect, test } from "@jest/globals";
import {
  ADDRESS_NAME_ADDRESS_DESCRIPTION,
  ADDRESS_NAME_ADDRESS_PLACEHOLDER,
  ADDRESS_NAME_ADDRESS_VALIDATION_MESSAGE,
  ADDRESS_NAME_NAME_DESCRIPTION,
  ADDRESS_NAME_NAME_PLACEHOLDER,
  ADDRESS_NAME_NAME_VALIDATION_MESSAGE,
  getNetworkAddressNameFormFields,
  validateAddressNameAddress,
  validateAddressNameName,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkAddressNameFormFields";
import NetworkAddressName from "Common/Models/DatabaseModels/NetworkAddressName";
import { Service as NetworkAddressNameServiceType } from "Common/Server/Services/NetworkAddressNameService";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * The Address Name form (issue #5340), the same on Network > Settings >
 * Address Names and behind "Name this address" on a Traffic page: a name,
 * and an address or a subnet. The form checks what the server checks
 * (NetworkAddressNameService), so it lets through exactly what is stored -
 * a form that refused what the server would keep, or kept what it refuses,
 * teaches the wrong rule.
 */

function values(data: {
  name?: unknown;
  address?: unknown;
}): FormValues<NetworkAddressName> {
  return data as unknown as FormValues<NetworkAddressName>;
}

function serverTakesAddress(value: unknown): boolean {
  try {
    NetworkAddressNameServiceType.readAddress(value);
    return true;
  } catch {
    return false;
  }
}

function serverTakesName(value: unknown): boolean {
  try {
    NetworkAddressNameServiceType.readName(value);
    return true;
  } catch {
    return false;
  }
}

describe("the Address Name form's fields", () => {
  const fields: Array<Field<NetworkAddressName>> =
    getNetworkAddressNameFormFields();

  test("a name, then the address or subnet: both required text", () => {
    expect(
      fields.map((field: Field<NetworkAddressName>): string => {
        return Object.keys(field.field || {})[0] || "";
      }),
    ).toEqual(["name", "address"]);

    for (const field of fields) {
      expect(field.required).toBe(true);
      expect(field.fieldType).toBe(FormFieldSchemaType.Text);
    }

    expect(fields[0]!.title).toBe("Name");
    expect(fields[1]!.title).toBe("Address or Subnet");
  });

  test("each says what it is for, with an example of what to write", () => {
    expect(fields[0]!.placeholder).toBe(ADDRESS_NAME_NAME_PLACEHOLDER);
    expect(fields[0]!.description).toBe(ADDRESS_NAME_NAME_DESCRIPTION);
    expect(fields[1]!.placeholder).toBe(ADDRESS_NAME_ADDRESS_PLACEHOLDER);
    expect(fields[1]!.description).toBe(ADDRESS_NAME_ADDRESS_DESCRIPTION);
    expect(ADDRESS_NAME_ADDRESS_PLACEHOLDER).toBe("10.18.167.0/24");
    expect(ADDRESS_NAME_NAME_PLACEHOLDER).toBe("Payroll SaaS");

    // A hint fits under a field.
    for (const text of [
      ADDRESS_NAME_NAME_DESCRIPTION,
      ADDRESS_NAME_ADDRESS_DESCRIPTION,
    ]) {
      expect(text.length).toBeLessThanOrEqual(150);
    }
  });

  test("each checks its value", () => {
    expect(fields[0]!.customValidation).toBe(validateAddressNameName);
    expect(fields[1]!.customValidation).toBe(validateAddressNameAddress);
  });

  test("the fields are the model's own columns", () => {
    const model: NetworkAddressName = new NetworkAddressName();

    for (const column of ["name", "address"]) {
      expect(model.getTableColumnMetadata(column)).toBeTruthy();
    }
  });
});

describe("the form takes what the server keeps, and refuses what it refuses", () => {
  const ADDRESSES: Array<unknown> = [
    "10.0.0.5",
    " 10.0.0.5 ",
    "2001:DB8::5",
    "10.18.167.0/24",
    "10.18.167.35/24",
    "2001:db8:1::/48",
    "::ffff:10.0.0.5",
    "0.0.0.0/0",
    "",
    "   ",
    "fileserver-01",
    "10.0.0.1-10.0.0.9",
    "10.0.0.5:443",
    "10.0.0.0/33",
    "fe80::1%eth0",
    undefined,
    null,
    5,
  ];

  test.each(ADDRESSES)("address %p", (value: unknown) => {
    const message: string | null = validateAddressNameAddress(
      values({ name: "x", address: value }),
    );

    expect(message === null).toBe(serverTakesAddress(value));

    if (message !== null) {
      expect(message).toBe(ADDRESS_NAME_ADDRESS_VALIDATION_MESSAGE);
    }
  });

  const NAMES: Array<unknown> = [
    "Payroll SaaS",
    "  Mumbai office ",
    "حقوق و دستمزد",
    "a",
    "",
    "   ",
    "\n\t",
    undefined,
    null,
    7,
  ];

  test.each(NAMES)("name %p", (value: unknown) => {
    const message: string | null = validateAddressNameName(
      values({ name: value, address: "10.0.0.5" }),
    );

    expect(message === null).toBe(serverTakesName(value));

    if (message !== null) {
      expect(message).toBe(ADDRESS_NAME_NAME_VALIDATION_MESSAGE);
    }
  });
});
