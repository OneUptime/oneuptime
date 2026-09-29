import { describe, expect, test } from "@jest/globals";
import {
  DevicePollingFormFieldOptions,
  getDevicePollingFormFields,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/DevicePollingFormFields";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * These tests pin the device-owned polling section of the Network Device
 * forms. The device polls itself — its assigned probe walks it on the
 * device's own schedule — so the four collection knobs live HERE, on the
 * device form, and not on any monitor form. Field keys and kinds are
 * asserted exactly: a renamed key silently stops persisting the column,
 * and a changed schema type renders the wrong control.
 */

const FIELD_KEY_POLLING_ENABLED: string = "isPollingEnabled";
const FIELD_KEY_POLLING_INTERVAL: string = "pollingIntervalInMinutes";
const FIELD_KEY_WALK_INTERFACES: string = "walkInterfaces";
const FIELD_KEY_COLLECT_ENDPOINTS: string = "collectEndpoints";

function getFieldKey(field: Field<NetworkDevice>): string {
  return Object.keys(field.field || {})[0] as string;
}

function getField(key: string): Field<NetworkDevice> {
  const field: Field<NetworkDevice> | undefined =
    getDevicePollingFormFields().find((item: Field<NetworkDevice>) => {
      return getFieldKey(item) === key;
    });

  if (!field) {
    throw new Error(`Device polling form field "${key}" not found`);
  }

  return field;
}

describe("getDevicePollingFormFields — field inventory", () => {
  test("exposes exactly the four device-owned polling fields, in order", () => {
    const keys: Array<string> = getDevicePollingFormFields().map(
      (field: Field<NetworkDevice>) => {
        return getFieldKey(field);
      },
    );

    expect(keys).toEqual([
      FIELD_KEY_POLLING_ENABLED,
      FIELD_KEY_POLLING_INTERVAL,
      FIELD_KEY_WALK_INTERFACES,
      FIELD_KEY_COLLECT_ENDPOINTS,
    ]);
  });

  test("returns a fresh array each call so callers cannot mutate each other's forms", () => {
    const first: Array<Field<NetworkDevice>> = getDevicePollingFormFields();
    const second: Array<Field<NetworkDevice>> = getDevicePollingFormFields();

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });
});

describe("getDevicePollingFormFields — schema types", () => {
  test.each([
    [FIELD_KEY_POLLING_ENABLED, FormFieldSchemaType.Toggle],
    [FIELD_KEY_POLLING_INTERVAL, FormFieldSchemaType.Number],
    [FIELD_KEY_WALK_INTERFACES, FormFieldSchemaType.Toggle],
    [FIELD_KEY_COLLECT_ENDPOINTS, FormFieldSchemaType.Toggle],
  ])("%s renders as %s", (key: string, schemaType: FormFieldSchemaType) => {
    expect(getField(key).fieldType).toBe(schemaType);
  });

  /*
   * None of these may be required: the columns all carry server-side
   * defaults (polling on, 5-minute interval, interfaces walked, endpoints
   * off), so an untouched form must save cleanly.
   */
  test.each([
    [FIELD_KEY_POLLING_ENABLED],
    [FIELD_KEY_POLLING_INTERVAL],
    [FIELD_KEY_WALK_INTERFACES],
    [FIELD_KEY_COLLECT_ENDPOINTS],
  ])("%s is optional", (key: string) => {
    expect(getField(key).required).toBe(false);
  });
});

describe("getDevicePollingFormFields — titles", () => {
  test.each([
    [FIELD_KEY_POLLING_ENABLED, "Polling Enabled"],
    [FIELD_KEY_POLLING_INTERVAL, "Polling Interval (Minutes)"],
    [FIELD_KEY_WALK_INTERFACES, "Walk Interfaces"],
    [FIELD_KEY_COLLECT_ENDPOINTS, "Collect Connected Endpoints (ARP + FDB)"],
  ])("%s is titled %p", (key: string, title: string) => {
    expect(getField(key).title).toBe(title);
  });
});

/*
 * The "Polling & Data Collection" card on Device Settings is a two-step
 * wizard — Polling, then Health OIDs — and BasicForm places a field on a step
 * purely from its `stepId`: a field carrying no stepId renders on EVERY step,
 * and a stepId naming no declared step renders on NONE. So all four knobs
 * have to be stamped with the caller's step, and callers that render the form
 * as a single page must still get unstamped fields back.
 */
describe("getDevicePollingFormFields — form step assignment", () => {
  const STEP_ID: string = "polling";

  function fieldsOf(
    options?: DevicePollingFormFieldOptions,
  ): Array<Field<NetworkDevice>> {
    return getDevicePollingFormFields(options);
  }

  function fieldKeysOf(options?: DevicePollingFormFieldOptions): Array<string> {
    return fieldsOf(options).map((field: Field<NetworkDevice>) => {
      return getFieldKey(field);
    });
  }

  function stepIdsOf(
    options?: DevicePollingFormFieldOptions,
  ): Array<string | undefined> {
    return fieldsOf(options).map((field: Field<NetworkDevice>) => {
      return field.stepId;
    });
  }

  test("with no options no field carries a stepId, so a single-page form is unaffected", () => {
    const stepIds: Array<string | undefined> = stepIdsOf();

    // Guards against a vacuous pass if the helper ever returns nothing.
    expect(stepIds.length).toBeGreaterThan(0);

    for (const stepId of stepIds) {
      expect(stepId).toBeUndefined();
    }
  });

  test.each([
    ["an empty options object", {}],
    ["an explicitly undefined stepId", { stepId: undefined }],
  ])(
    "%s leaves every field unstepped",
    (_label: string, options: DevicePollingFormFieldOptions) => {
      for (const stepId of stepIdsOf(options)) {
        expect(stepId).toBeUndefined();
      }
    },
  );

  test('with { stepId: "polling" } every returned field carries that step', () => {
    const stepIds: Array<string | undefined> = stepIdsOf({ stepId: STEP_ID });

    expect(stepIds.length).toBe(fieldKeysOf().length);
    expect(stepIds.length).toBeGreaterThan(0);

    for (const stepId of stepIds) {
      expect(stepId).toBe(STEP_ID);
    }
  });

  test.each([
    [FIELD_KEY_POLLING_ENABLED],
    [FIELD_KEY_POLLING_INTERVAL],
    [FIELD_KEY_WALK_INTERFACES],
    [FIELD_KEY_COLLECT_ENDPOINTS],
  ])("%s lands on the requested step", (key: string) => {
    const field: Field<NetworkDevice> | undefined = fieldsOf({
      stepId: STEP_ID,
    }).find((item: Field<NetworkDevice>) => {
      return getFieldKey(item) === key;
    });

    expect(field).toBeDefined();
    expect(field!.stepId).toBe(STEP_ID);
  });

  test("the step does not change the field keys or their order", () => {
    expect(fieldKeysOf({ stepId: STEP_ID })).toEqual(fieldKeysOf());
  });

  test("the step is the only property that changes", () => {
    const plain: Array<Field<NetworkDevice>> = fieldsOf();
    const stepped: Array<Field<NetworkDevice>> = fieldsOf({ stepId: STEP_ID });

    expect(stepped).toHaveLength(plain.length);

    plain.forEach((field: Field<NetworkDevice>, index: number) => {
      const other: Field<NetworkDevice> = stepped[index]!;

      expect(getFieldKey(other)).toBe(getFieldKey(field));
      expect(other.title).toBe(field.title);
      expect(other.fieldType).toBe(field.fieldType);
      expect(other.required).toBe(field.required);
      expect(other.placeholder).toBe(field.placeholder);
      expect(other.description).toBe(field.description);
    });
  });

  /*
   * None of these fields is conditional, and stamping must not make one so:
   * a showIf appearing here would hide a polling knob behind a predicate
   * nobody wrote.
   */
  test("no field gains a showIf on the way to a step", () => {
    for (const field of fieldsOf({ stepId: STEP_ID })) {
      expect(field.showIf).toBeUndefined();
    }
  });

  /*
   * Device Settings renders this form alongside the SNMP form on the same
   * page load, so stamping has to build new field objects rather than mutate
   * the shared literals.
   */
  test("stamping a step does not leak into a later unstepped call", () => {
    fieldsOf({ stepId: STEP_ID });

    for (const stepId of stepIdsOf()) {
      expect(stepId).toBeUndefined();
    }
  });

  test("two stepped calls do not share field objects", () => {
    const first: Array<Field<NetworkDevice>> = fieldsOf({ stepId: STEP_ID });
    const second: Array<Field<NetworkDevice>> = fieldsOf({
      stepId: "somewhere-else",
    });

    expect(first[0]).not.toBe(second[0]);
    expect(first[0]!.stepId).toBe(STEP_ID);
    expect(second[0]!.stepId).toBe("somewhere-else");
  });
});
