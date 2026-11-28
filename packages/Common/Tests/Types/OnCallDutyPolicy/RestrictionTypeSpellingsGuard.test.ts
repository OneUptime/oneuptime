import RestrictionTimes, {
  LEGACY_RESTRICTION_TYPE_KEY,
  RESTRICTION_TYPE_KEY,
  RESTRICTION_TYPE_KEYS_IN_ANSWERS,
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { JSONObject } from "../../../Types/JSON";
import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONLY THE COMPATIBILITY LAYER NAMES A RESTRICTION TYPE'S OLDER SPELLING
 * (#11456, #11457).
 *
 * A restriction's type was spelled restictionType, without the second "r",
 * until #11269. It is read on write for good, and sent beside
 * restrictionType in answers while it is deprecated
 * (RESTRICTION_TYPE_KEYS_IN_ANSWERS says how it goes). So that taking it out
 * of answers touches what it must and nothing is missed, every file of
 * product code that names it - as text, or as LEGACY_RESTRICTION_TYPE_KEY -
 * is listed here with why; a new one fails until it is listed, or reads
 * restrictionType instead. The Dashboard read the type through the
 * deprecated accessor in five files until #11457: no file outside
 * RestrictionTimes reads it now.
 *
 * Tests, docs, locale files, schema migrations (their stored defaults are
 * history) and the end-to-end Terraform configurations are not product code
 * and are not read.
 */

const SCAN_TIMEOUT_IN_MS: number = 300000;

const NAMES_THE_OLDER_SPELLING: RegExp =
  /restictionType|LEGACY_RESTRICTION_TYPE_KEY/;

// The deprecated accessor, read or set on a value: `.restictionType`.
const DEPRECATED_ACCESSOR: RegExp = /\.restictionType\b/;

// The Terraform provider's Go, which the TypeScript walk does not read.
const PROVIDER_GO_FOLDER: string = "Scripts/TerraformProvider/StaticFiles";

/*
 * Schema migrations: each one's column defaults are the table as it was
 * then, kept as written.
 */
const SCHEMA_MIGRATIONS_FOLDER: string =
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/";

/*
 * Every file of product code that names the older spelling, and why. Taking
 * it out of answers (#11456, step 3) is a change to the first; steps 1 and
 * 2 explain the rest.
 */
const NAMES_IT_BECAUSE: Record<string, string> = {
  "packages/Common/Types/OnCallDutyPolicy/RestrictionTimes.ts":
    "the compatibility layer: the key, read on write and in stored rows, sent in answers while RESTRICTION_TYPE_KEYS_IN_ANSWERS holds it, and the deprecated accessor",
  "packages/Common/Server/Services/OnCallDutyPolicyScheduleLayerService.ts":
    "reads a write's two spellings to tell which one a client that read both changed",
  "packages/App/FeatureSet/Workers/DataMigrations/RepairScheduleLayerRestrictionTypes.ts":
    "#11269's one-off repair reads what the engine read before it: the older key alone",
  "packages/App/FeatureSet/APIReference/Service/DataTypeDetail.ts":
    "the API reference says the older spelling is read, and deprecated in answers",
  "Scripts/TerraformProvider/Core/DocumentationGenerator.ts":
    "the provider's guide and examples write restictionType, which every server reads, until #11456's step 2",
  "Scripts/TerraformProvider/Core/MonitorStepsActiveHoursCases.ts":
    "the provider's monitor-steps cases: configurations written with the older spelling still apply",
  "Scripts/TerraformProvider/StaticFiles/monitorsteps.go":
    "the provider's monitor-steps writer sends both spellings for servers before 18.0.0, and its reader reads both, until #11456's step 2",
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8");
}

function listProviderGoFiles(): Array<string> {
  const folder: string = path.join(REPOSITORY_DIRECTORY, PROVIDER_GO_FOLDER);

  if (!fs.existsSync(folder)) {
    return [];
  }

  return fs
    .readdirSync(folder)
    .filter((name: string): boolean => {
      return name.endsWith(".go") && !name.endsWith("_test.go");
    })
    .map((name: string): string => {
      return `${PROVIDER_GO_FOLDER}/${name}`;
    });
}

let productFiles: Array<string> | null = null;

function getProductFiles(): Array<string> {
  if (!productFiles) {
    productFiles = [...listProductFiles(), ...listProviderGoFiles()].filter(
      (file: string): boolean => {
        return !file.startsWith(SCHEMA_MIGRATIONS_FOLDER);
      },
    );
  }

  return productFiles;
}

describe("the older spelling of a restriction's type", () => {
  test(
    "is named only by the files listed, each for its reason",
    () => {
      const naming: Array<string> = getProductFiles()
        .filter((file: string): boolean => {
          return NAMES_THE_OLDER_SPELLING.test(read(file));
        })
        .sort();

      expect(naming).toEqual(Object.keys(NAMES_IT_BECAUSE).sort());
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test(
    "REGRESSION #11457: its deprecated accessor is read nowhere outside RestrictionTimes - not by the Dashboard",
    () => {
      const reading: Array<string> = getProductFiles().filter(
        (file: string): boolean => {
          return (
            file !==
              "packages/Common/Types/OnCallDutyPolicy/RestrictionTimes.ts" &&
            DEPRECATED_ACCESSOR.test(read(file))
          );
        },
      );

      expect(reading).toEqual([]);
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test("the scan read the Dashboard's on-call layer files, and the provider's Go", () => {
    const files: Set<string> = new Set<string>(getProductFiles());

    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerConfigForm.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerRotationSummary.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursPicker.tsx",
      "Scripts/TerraformProvider/StaticFiles/monitorsteps.go",
    ]) {
      expect({ file, read: files.has(file) }).toEqual({ file, read: true });
    }
  });
});

describe("REGRESSION #11456: the deprecation, step 1", () => {
  test("answers carry the type under its name and, while it is deprecated, its older spelling", () => {
    expect(RESTRICTION_TYPE_KEYS_IN_ANSWERS).toEqual([
      RESTRICTION_TYPE_KEY,
      LEGACY_RESTRICTION_TYPE_KEY,
    ]);

    const restriction: RestrictionTimes = new RestrictionTimes();
    restriction.restrictionType = RestrictionType.Daily;

    const value: JSONObject = restriction.toJSON()["value"] as JSONObject;

    expect(Object.keys(value)).toEqual([
      ...RESTRICTION_TYPE_KEYS_IN_ANSWERS,
      "dayRestrictionTimes",
      "weeklyRestrictionTimes",
    ]);
    for (const key of RESTRICTION_TYPE_KEYS_IN_ANSWERS) {
      expect(value[key]).toBe(RestrictionType.Daily);
    }
  });

  test("what is stored carries the type under its name alone", () => {
    const restriction: RestrictionTimes = new RestrictionTimes();
    restriction.restrictionType = RestrictionType.Weekly;

    const value: JSONObject = restriction.toDatabaseJSON()[
      "value"
    ] as JSONObject;

    expect(value[RESTRICTION_TYPE_KEY]).toBe(RestrictionType.Weekly);
    expect(LEGACY_RESTRICTION_TYPE_KEY in value).toBe(false);
  });

  test("the older spelling is read on write, and always will be", () => {
    expect(
      RestrictionTimes.fromWrittenJSON({
        _type: "RestrictionTimes",
        value: { [LEGACY_RESTRICTION_TYPE_KEY]: "None" },
      }).restrictionType,
    ).toBe(RestrictionType.None);
  });

  test("the deprecation and its steps are written beside the list that ends it", () => {
    const source: string = read(
      "packages/Common/Types/OnCallDutyPolicy/RestrictionTimes.ts",
    );

    expect(source).toContain(
      "THE OLDER SPELLING IN ANSWERS IS DEPRECATED (#11456).",
    );
    expect(source).toContain(
      "The first major version released on or after 1 June 2027",
    );
    expect(source).toContain(
      "Step 3 is taking LEGACY_RESTRICTION_TYPE_KEY out of this list",
    );
  });
});
