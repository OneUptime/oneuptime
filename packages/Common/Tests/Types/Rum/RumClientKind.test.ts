import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  RUM_CLIENT_KIND_BROWSER,
  RUM_CLIENT_KIND_MOBILE,
  RumClientKind,
  getRumClientKind,
  readRumClientKind,
} from "../../../Types/Rum/RumClientKind";

/*
 * Whether a RUM application is a browser app or a mobile app, as ingest
 * records it on RumApplication.clientType. The Overview (#9588) and the
 * Recommendations (#9589) both read it through this one module.
 */

describe("readRumClientKind", () => {
  test.each([
    ["mobile", "mobile"],
    ["browser", "browser"],
    // The column is drawn capitalised in places; ingest writes lower case.
    ["Mobile", "mobile"],
    ["BROWSER", "browser"],
    ["  mobile  ", "mobile"],
  ])("reads %j as %j", (clientType: string, expected: string) => {
    expect(readRumClientKind(clientType)).toBe(expected);
  });

  test.each([
    [null],
    [undefined],
    [""],
    ["   "],
    // Values ingest never writes are not guessed at.
    ["desktop"],
    ["android"],
    ["ios"],
    ["mobile-web"],
    [42],
    [true],
    [{ clientType: "mobile" }],
  ])("is not known for %j", (clientType: unknown) => {
    expect(readRumClientKind(clientType)).toBeNull();
  });
});

describe("getRumClientKind", () => {
  test("a mobile application is drawn as one", () => {
    expect(getRumClientKind("mobile")).toBe(RUM_CLIENT_KIND_MOBILE);
    expect(getRumClientKind(" Mobile ")).toBe(RUM_CLIENT_KIND_MOBILE);
  });

  test("a browser application is drawn as one", () => {
    expect(getRumClientKind("browser")).toBe(RUM_CLIENT_KIND_BROWSER);
  });

  test.each([[null], [undefined], [""], ["desktop"], [7]])(
    "an application of no known kind (%j) keeps the browser pages",
    (clientType: unknown) => {
      expect(getRumClientKind(clientType)).toBe(RUM_CLIENT_KIND_BROWSER);
    },
  );

  test("the constants are the values ingest writes", () => {
    const kinds: Array<RumClientKind> = [
      RUM_CLIENT_KIND_BROWSER,
      RUM_CLIENT_KIND_MOBILE,
    ];

    expect(kinds).toEqual(["browser", "mobile"]);
  });
});

describe("ingest writes only what this module reads", () => {
  /*
   * OtelIngestBaseService.getRumClientType decides the kind and the
   * heartbeat stores it as RumApplication.clientType. It returns this
   * module's constants, never a literal of its own, so a reader and the
   * writer cannot drift apart.
   */
  const INGEST_SOURCE: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../../../App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
    ),
    "utf8",
  );

  function getRumClientTypeBody(): string {
    const start: number = INGEST_SOURCE.indexOf(
      "protected static getRumClientType(",
    );
    expect(start).toBeGreaterThan(-1);
    const end: number = INGEST_SOURCE.indexOf("\n  }\n", start);
    expect(end).toBeGreaterThan(start);
    return INGEST_SOURCE.slice(start, end);
  }

  test("every kind the classifier returns is a shared constant", () => {
    const body: string = getRumClientTypeBody();

    expect(body).toContain("RumClientKind | null");
    expect(body).toContain("return RUM_CLIENT_KIND_BROWSER;");
    expect(body).toContain("return RUM_CLIENT_KIND_MOBILE;");
    expect(body).not.toMatch(/return "(browser|mobile)";/);
  });
});
