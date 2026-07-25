import { describe, expect, test } from "@jest/globals";
import { getDevicePollingFormFields } from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/DevicePollingFormFields";
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
