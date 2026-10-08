import {
  fillDeviceNameOnCreate,
  getDeviceNameForCreate,
} from "../../../Utils/NetworkDevice/DeviceNameDefault";
import { describe, expect, test } from "@jest/globals";

/*
 * The Add Device form asks for the address first and leaves the name
 * optional; a device added without one is named after its address. The rule
 * is shared by the form (AddDeviceForm / Devices.tsx onBeforeCreate) and the
 * server (NetworkDeviceService.onBeforeCreate), so a device made either way
 * ends up with the same name. These pin the rule itself.
 */

describe("getDeviceNameForCreate", () => {
  test("keeps a name that was given", () => {
    expect(getDeviceNameForCreate("core-switch-01", "10.0.0.1")).toBe(
      "core-switch-01",
    );
  });

  test("trims a name that was given", () => {
    expect(getDeviceNameForCreate("  core-switch-01 \n", "10.0.0.1")).toBe(
      "core-switch-01",
    );
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
    ["spaces", "   "],
    ["a tab and a newline", "\t\n"],
  ])(
    "uses the hostname when the name is %s",
    (_label: string, name: string | undefined | null): void => {
      expect(getDeviceNameForCreate(name, "10.0.0.1")).toBe("10.0.0.1");
    },
  );

  test("trims the hostname it falls back to", () => {
    expect(getDeviceNameForCreate("", "  switch-01.example.com  ")).toBe(
      "switch-01.example.com",
    );
  });

  test("a hostname name keeps its case and its dots", () => {
    expect(getDeviceNameForCreate(undefined, "Core-SW-01.Corp.Example.com")).toBe(
      "Core-SW-01.Corp.Example.com",
    );
  });

  test.each([
    ["both undefined", undefined, undefined],
    ["both null", null, null],
    ["both blank", " ", "  "],
    ["a blank name and no hostname", "", undefined],
  ])(
    "is empty with %s",
    (
      _label: string,
      name: string | undefined | null,
      hostname: string | undefined | null,
    ): void => {
      expect(getDeviceNameForCreate(name, hostname)).toBe("");
    },
  );

  test("a value that is not text is read as text, never thrown on", () => {
    expect(
      getDeviceNameForCreate(42 as unknown as string, "10.0.0.1"),
    ).toBe("42");
    expect(
      getDeviceNameForCreate(undefined, 1234 as unknown as string),
    ).toBe("1234");
  });
});

describe("fillDeviceNameOnCreate", () => {
  test("names a payload with no name after its hostname, in place", () => {
    const data: { name?: string | undefined; hostname?: string | undefined } =
      { hostname: "10.0.0.7" };

    fillDeviceNameOnCreate(data);

    expect(data.name).toBe("10.0.0.7");
    expect(data.hostname).toBe("10.0.0.7");
  });

  test("names a payload with a blank name after its hostname", () => {
    const data: { name?: string | undefined; hostname?: string | undefined } =
      { name: "  ", hostname: " 10.0.0.7 " };

    fillDeviceNameOnCreate(data);

    expect(data.name).toBe("10.0.0.7");
  });

  test("only trims a name that was given, and leaves the hostname alone", () => {
    const data: { name?: string | undefined; hostname?: string | undefined } =
      { name: " edge-fw ", hostname: " 10.0.0.7 " };

    fillDeviceNameOnCreate(data);

    expect(data.name).toBe("edge-fw");
    expect(data.hostname).toBe(" 10.0.0.7 ");
  });

  /*
   * A payload with neither is not given an empty name: it is left exactly
   * as it came, so the required-field check that runs after the hook still
   * says which field is missing.
   */
  test("leaves a payload with neither a name nor a hostname untouched", () => {
    const data: { name?: string | undefined; hostname?: string | undefined } =
      {};

    fillDeviceNameOnCreate(data);

    expect(data).toEqual({});
    expect("name" in data).toBe(false);
  });

  test("leaves a blank name in place when the hostname is blank too", () => {
    const data: { name?: string | undefined; hostname?: string | undefined } =
      { name: "", hostname: "" };

    fillDeviceNameOnCreate(data);

    expect(data.name).toBe("");
  });
});
