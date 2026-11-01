import {
  getCiscoPhoneMac,
  parseMerakiAdvertisedName,
} from "../../../Utils/Monitor/NeighborIdentityUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * What a name a neighbour advertises says about the box behind it
 * (OneUptime issue #5379). The first two spellings are Meraki's own, from the
 * examples of its API.
 */

describe("the name a Meraki device advertises", () => {
  test("with the brand in front", () => {
    expect(parseMerakiAdvertisedName("Meraki MS350-24X - Phineas")).toEqual({
      name: "Phineas",
      model: "MS350-24X",
    });
  });

  test("without it", () => {
    expect(parseMerakiAdvertisedName("MS350-24X - Test")).toEqual({
      name: "Test",
      model: "MS350-24X",
    });
  });

  test.each([
    ["Meraki MX85 - UN0660WANRTR01", "UN0660WANRTR01", "MX85"],
    ["Meraki MR70 - UN0660OUTWAP07", "UN0660OUTWAP07", "MR70"],
    ["meraki mx67 - lowercase", "lowercase", "mx67"],
    ["MR36 - Lobby", "Lobby", "MR36"],
    ["MX68CW-WW - Branch", "Branch", "MX68CW-WW"],
    ["Z3 - Home office", "Home office", "Z3"],
    ["CW9166I - Roof", "Roof", "CW9166I"],
  ])("%s", (value: string, name: string, model: string) => {
    expect(parseMerakiAdvertisedName(value)).toEqual({ name, model });
  });

  test("the first separator is the one that counts: a name may hold one too", () => {
    expect(
      parseMerakiAdvertisedName("Meraki MS120 - Store 5 - Kitchen"),
    ).toEqual({ name: "Store 5 - Kitchen", model: "MS120" });
  });

  test("padding around it does not matter", () => {
    expect(parseMerakiAdvertisedName("  Meraki MX85 -  Edge  ")).toEqual({
      name: "Edge",
      model: "MX85",
    });
  });

  test.each([
    ["a plain name", "core-sw-01"],
    ["a name with a dash in it", "core-sw-01 - spare"],
    ["somebody's own label", "SW1 - Core"],
    ["a router's", "R1 - Edge"],
    ["a vendor that is not Meraki", "Cisco C9300 - Core"],
    ["the brand and no model", "Meraki - Core"],
    ["a model with a space in it", "Meraki MS 120 - Core"],
    ["nothing after the separator", "Meraki MX85 - "],
    ["no space around the dash", "Meraki MX85-Edge"],
    ["only a separator", " - "],
    ["empty", ""],
  ])("%s is not one", (_label: string, value: string) => {
    expect(parseMerakiAdvertisedName(value)).toBeUndefined();
  });

  test("nothing at all is not one", () => {
    expect(parseMerakiAdvertisedName(undefined)).toBeUndefined();
  });

  test("a value of any length is read in a name's length, and at once", () => {
    const started: number = Date.now();

    expect(parseMerakiAdvertisedName("x".repeat(4_000_000))).toBeUndefined();
    expect(
      parseMerakiAdvertisedName(`MS${"1".repeat(4_000_000)} - name`),
    ).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe("the MAC address in a Cisco phone's name", () => {
  test("the phone on the issue's map", () => {
    expect(getCiscoPhoneMac("SEP002F5C7BF3E4")).toBe("00:2f:5c:7b:f3:e4");
  });

  test("whichever way it was cased, as a lower-cased match key is", () => {
    expect(getCiscoPhoneMac("sep002f5c7bf3e4")).toBe("00:2f:5c:7b:f3:e4");
  });

  test.each([
    ["too short", "SEP002F5C7BF3"],
    ["too long", "SEP002F5C7BF3E4AA"],
    ["not hex", "SEP002F5C7BF3GG"],
    ["another name altogether", "W600805EC073AB90"],
    ["a name that starts the same way", "SEPTEMBER-SWITCH"],
    ["a MAC with no SEP", "002F5C7BF3E4"],
    ["empty", ""],
  ])("%s has none", (_label: string, value: string) => {
    expect(getCiscoPhoneMac(value)).toBeUndefined();
  });

  test("nothing at all has none", () => {
    expect(getCiscoPhoneMac(undefined)).toBeUndefined();
  });
});
