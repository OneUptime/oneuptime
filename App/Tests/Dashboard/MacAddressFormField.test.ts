import { describe, expect, test } from "@jest/globals";
import {
  MAC_ADDRESS_FIELD_DESCRIPTION,
  MAC_ADDRESS_FIELD_PLACEHOLDER,
  MAC_ADDRESS_FIELD_TITLE,
  MAC_ADDRESS_VALIDATION_MESSAGE,
  MacAddressFormFieldOptions,
  getMacAddressFormField,
  validateMacAddress,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/MacAddressFormField";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * The MAC Address field is what lets the topology map put a ping-only
 * device - a register, a handset, a kiosk - on the switch port its switch's
 * forwarding table says it is on. Four NetworkDevice forms render it through
 * one helper so they cannot drift; this pins the helper itself, the way
 * DevicePollingFormFields.test.ts pins the polling knobs.
 *
 * The key is asserted exactly: a renamed key silently stops persisting the
 * column, and the map then matches nothing. The validator is asserted
 * against every spelling the SERVER accepts, because a form that refuses
 * "AA-BB-CC-DD-EE-FF" while the server would have stored it is a form that
 * teaches the operator the wrong rule - and the message it prints has to be
 * the server's, so the rule reads the same whichever side catches it.
 */

const FIELD_KEY: string = "macAddress";

const STEP_ID: string = "device-details";

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");

const SERVER_SERVICE_SOURCE: string = path.join(
  REPO_ROOT,
  "Common",
  "Server",
  "Services",
  "NetworkDeviceService.ts",
);

/*
 * The part of the message both sides must share word for word. The server
 * refuses a value the normaliser rejects with a message that starts like
 * this, and the client validator prints the same message BEFORE the save is
 * attempted, so an operator never sees two different rules for one box.
 */
const SHARED_MESSAGE_PREFIX: string =
  "MAC Address must be six pairs of hex digits";

function getFieldKey(field: Field<NetworkDevice>): string {
  return Object.keys(field.field || {})[0] as string;
}

function valuesWith(macAddress: unknown): FormValues<NetworkDevice> {
  return { macAddress: macAddress } as FormValues<NetworkDevice>;
}

describe("getMacAddressFormField — shape", () => {
  test("persists the macAddress column", () => {
    expect(getFieldKey(getMacAddressFormField())).toBe(FIELD_KEY);
  });

  test("is a plain text box", () => {
    expect(getMacAddressFormField().fieldType).toBe(FormFieldSchemaType.Text);
  });

  /*
   * Optional, not merely defaulted: most devices are walked over SNMP and
   * never need one, and a required MAC would block every switch's create
   * form on a value the switch reports about itself anyway.
   */
  test("is optional", () => {
    expect(getMacAddressFormField().required).toBe(false);
  });

  test("carries the shared title, placeholder and description", () => {
    const field: Field<NetworkDevice> = getMacAddressFormField();

    expect(field.title).toBe(MAC_ADDRESS_FIELD_TITLE);
    expect(field.title).toBe("MAC Address");
    expect(field.placeholder).toBe(MAC_ADDRESS_FIELD_PLACEHOLDER);
    expect(field.description).toBe(MAC_ADDRESS_FIELD_DESCRIPTION);
  });

  test("the placeholder is itself a value the validator accepts", () => {
    expect(validateMacAddress(valuesWith(MAC_ADDRESS_FIELD_PLACEHOLDER))).toBe(
      null,
    );
  });

  /*
   * The validator is wired by identity, not copied: a form that rendered a
   * lookalike would accept what the server refuses.
   */
  test("validates through validateMacAddress", () => {
    expect(getMacAddressFormField().customValidation).toBe(validateMacAddress);
  });

  test("gains no showIf: the field is never conditional", () => {
    expect(getMacAddressFormField().showIf).toBeUndefined();
    expect(getMacAddressFormField({ stepId: STEP_ID }).showIf).toBeUndefined();
  });
});

/*
 * Three of the four callers are stepped wizards, and BasicForm places a
 * field on a step purely from its `stepId`: a field carrying none renders on
 * EVERY step and one naming an undeclared step renders on NONE. The Overview
 * card is a single-page form and must get an unstamped field back.
 */
describe("getMacAddressFormField — form step assignment", () => {
  test("with no options carries no stepId, so a single-page form is unaffected", () => {
    expect(getMacAddressFormField().stepId).toBeUndefined();
  });

  test.each([
    ["an empty options object", {}],
    ["an explicitly undefined stepId", { stepId: undefined }],
    ["an empty stepId", { stepId: "" }],
  ])(
    "%s leaves the field unstepped",
    (_label: string, options: MacAddressFormFieldOptions) => {
      expect(getMacAddressFormField(options).stepId).toBeUndefined();
    },
  );

  test("with a stepId the field carries that step", () => {
    expect(getMacAddressFormField({ stepId: STEP_ID }).stepId).toBe(STEP_ID);
  });

  test("the step is the only property that changes", () => {
    const plain: Field<NetworkDevice> = getMacAddressFormField();
    const stepped: Field<NetworkDevice> = getMacAddressFormField({
      stepId: STEP_ID,
    });

    expect(getFieldKey(stepped)).toBe(getFieldKey(plain));
    expect(stepped.title).toBe(plain.title);
    expect(stepped.fieldType).toBe(plain.fieldType);
    expect(stepped.required).toBe(plain.required);
    expect(stepped.placeholder).toBe(plain.placeholder);
    expect(stepped.description).toBe(plain.description);
    expect(stepped.customValidation).toBe(plain.customValidation);
  });

  /*
   * Device Settings renders the stepped form on the same page load as the
   * Overview renders the unstepped one, so stamping has to build a new
   * object rather than mutate a shared literal.
   */
  test("returns a fresh object each call so callers cannot mutate each other's forms", () => {
    const first: Field<NetworkDevice> = getMacAddressFormField();
    const second: Field<NetworkDevice> = getMacAddressFormField();

    expect(first).not.toBe(second);
    expect(first.field).not.toBe(second.field);
  });

  test("stamping a step does not leak into a later unstepped call", () => {
    getMacAddressFormField({ stepId: STEP_ID });

    expect(getMacAddressFormField().stepId).toBeUndefined();
  });

  test("two stepped calls do not share the field object", () => {
    const first: Field<NetworkDevice> = getMacAddressFormField({
      stepId: STEP_ID,
    });
    const second: Field<NetworkDevice> = getMacAddressFormField({
      stepId: "somewhere-else",
    });

    expect(first).not.toBe(second);
    expect(first.stepId).toBe(STEP_ID);
    expect(second.stepId).toBe("somewhere-else");
  });
});

describe("validateMacAddress — blank is not an error", () => {
  /*
   * The field is optional, so a blank box says nothing here and is left to
   * `required` - the same split validateSnmpPort makes.
   */
  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("%s passes", (_label: string, raw: unknown) => {
    expect(validateMacAddress(valuesWith(raw))).toBe(null);
  });

  test("a form with no macAddress key at all passes", () => {
    expect(validateMacAddress({} as FormValues<NetworkDevice>)).toBe(null);
  });
});

describe("validateMacAddress — every spelling the server accepts", () => {
  test.each([
    ["colon form", "aa:bb:cc:dd:ee:ff"],
    ["upper-case dash form", "AA-BB-CC-DD-EE-FF"],
    ["Cisco dotted form", "aabb.ccdd.eeff"],
    ["bare hex", "aabbccddeeff"],
    ["0x-prefixed bare hex", "0xaabbccddeeff"],
    ["colon form with surrounding whitespace", "  aa:bb:cc:dd:ee:ff  "],
  ])("%s passes", (_label: string, raw: string) => {
    expect(validateMacAddress(valuesWith(raw))).toBe(null);
  });
});

describe("validateMacAddress — what the server would refuse", () => {
  test.each([
    ["words", "hello"],
    ["five pairs", "aa:bb:cc:dd:ee"],
    ["a non-hex pair", "gg:bb:cc:dd:ee:ff"],
    ["seven pairs", "aa:bb:cc:dd:ee:ff:00"],
    ["an IP address", "10.0.0.1"],
  ])("%s is refused with the shared message", (_label: string, raw: string) => {
    expect(validateMacAddress(valuesWith(raw))).toBe(
      MAC_ADDRESS_VALIDATION_MESSAGE,
    );
  });
});

/*
 * The client message and the server message are the same words. Read from
 * the server's SOURCE rather than imported: NetworkDeviceService pulls in
 * the whole server-side module graph, which the App suite does not load,
 * and the point is the wording, which a source read pins just as well.
 */
describe("validateMacAddress — agrees with the server", () => {
  const serverSource: string = fs
    .readFileSync(SERVER_SERVICE_SOURCE, "utf8")
    .replace(/\s+/g, " ");

  test("the client message starts with the shared prefix", () => {
    expect(
      MAC_ADDRESS_VALIDATION_MESSAGE.startsWith(SHARED_MESSAGE_PREFIX),
    ).toBe(true);
  });

  test("the server refuses a malformed MAC with the same prefix", () => {
    expect(serverSource).toContain(SHARED_MESSAGE_PREFIX);
  });

  test("the server's message is the client's, word for word", () => {
    expect(serverSource).toContain(MAC_ADDRESS_VALIDATION_MESSAGE);
  });
});
