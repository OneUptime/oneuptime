import {
  NUMBERED_RECORD_KINDS,
  NumberedRecordKind,
  NumberedRecordKindInfo,
} from "../../../Utils/Project/NextNumber";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY RECORD NUMBER IS TAKEN IN ONE PLACE.
 *
 * A project chooses where its incident, incident episode, alert, alert
 * episode and scheduled maintenance numbers start, and a number is never
 * given twice, because exactly one statement hands numbers out:
 * ProjectService.takeNextNumber moves a kind's counter to the higher of the
 * one after it and the chosen start, and answers what it moved to. A second
 * way in - a service that reads the counter and adds one, a job that sets
 * it, a record numbered from MAX(number) + 1 - would ignore the start, or
 * hand out a number twice when two records are created at once, and no test
 * of the first way would notice.
 *
 * So this reads the source:
 *
 *   - the counter columns are named only where they are declared, where
 *     each kind's is listed for ProjectService (Utils/Project/NextNumber),
 *     and where they were added (and in a few one-off data migrations whose
 *     local variables share the name);
 *   - each kind's record service numbers its records from its own
 *     ProjectService method, once, and nothing else calls that method;
 *   - each of those methods hands its kind to takeNextNumber, and
 *     takeNextNumber is the one statement that writes a counter.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

// Where server code that could number a record lives.
const SOURCE_ROOTS: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Utils",
  "packages/Common/Types",
  "packages/Common/Models",
  "packages/App/FeatureSet",
  "ee/Server",
];

/*
 * The files that may name a counter column, and why. An entry the source
 * no longer needs fails below: delete it.
 */
const MAY_NAME_A_COUNTER: Record<string, string> = {
  "packages/Common/Models/DatabaseModels/Project.ts": "declares the counters",
  "packages/Common/Utils/Project/NextNumber.ts":
    "names each kind's counter, start and prefix: ProjectService takes the numbers and checks a start through it",
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1770237245070-MigrationName.ts":
    "added the counters and set each to the highest number its records had",
  "packages/App/FeatureSet/Workers/DataMigrations/AddAlertNumber.ts":
    "a local variable of the one-off migration that numbered alerts before there were counters",
  "packages/App/FeatureSet/Workers/DataMigrations/AddIncidentNumber.ts":
    "a local variable of the one-off migration that numbered incidents before there were counters",
  "packages/App/FeatureSet/Workers/DataMigrations/AddScheduledMaintenanceNumber.ts":
    "a local variable of the one-off migration that numbered events before there were counters",
};

// Each kind's record service and the ProjectService method it numbers with.
const RECORD_SERVICES: Record<
  NumberedRecordKind,
  { file: string; method: string; numberColumn: string }
> = {
  [NumberedRecordKind.Incident]: {
    file: "packages/Common/Server/Services/IncidentService.ts",
    method: "incrementAndGetIncidentCounter",
    numberColumn: "incidentNumber",
  },
  [NumberedRecordKind.IncidentEpisode]: {
    file: "packages/Common/Server/Services/IncidentEpisodeService.ts",
    method: "incrementAndGetIncidentEpisodeCounter",
    numberColumn: "episodeNumber",
  },
  [NumberedRecordKind.Alert]: {
    file: "packages/Common/Server/Services/AlertService.ts",
    method: "incrementAndGetAlertCounter",
    numberColumn: "alertNumber",
  },
  [NumberedRecordKind.AlertEpisode]: {
    file: "packages/Common/Server/Services/AlertEpisodeService.ts",
    method: "incrementAndGetAlertEpisodeCounter",
    numberColumn: "episodeNumber",
  },
  [NumberedRecordKind.ScheduledMaintenance]: {
    file: "packages/Common/Server/Services/ScheduledMaintenanceService.ts",
    method: "incrementAndGetScheduledMaintenanceCounter",
    numberColumn: "scheduledMaintenanceNumber",
  },
};

const PROJECT_SERVICE: string =
  "packages/Common/Server/Services/ProjectService.ts";

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

function sourceFiles(): Array<string> {
  const files: Array<string> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "Tests") {
          continue;
        }

        walk(full);
        continue;
      }

      if (SOURCE_FILE.test(entry.name)) {
        files.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
      }
    }
  };

  for (const root of SOURCE_ROOTS) {
    const full: string = path.join(REPO_ROOT, root);

    if (fs.existsSync(full)) {
      walk(full);
    }
  }

  return files.sort();
}

function read(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

const IDENTIFIER_CHARACTER: RegExp = /[A-Za-z0-9_$]/;

// Whether `text` holds `name` as a whole identifier, not inside a longer one.
function namesIdentifier(text: string, name: string): boolean {
  let from: number = text.indexOf(name);

  while (from !== -1) {
    const before: string = from > 0 ? text.charAt(from - 1) : "";
    const after: string = text.charAt(from + name.length);

    if (
      !IDENTIFIER_CHARACTER.test(before) &&
      !IDENTIFIER_CHARACTER.test(after)
    ) {
      return true;
    }

    from = text.indexOf(name, from + 1);
  }

  return false;
}

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

const COUNTERS: Array<string> = NUMBERED_RECORD_KINDS.map(
  (info: NumberedRecordKindInfo): string => {
    return info.counterColumn;
  },
);

describe("every record number is taken in one place", () => {
  const files: Array<string> = sourceFiles();

  test("the scan reads the server's source", () => {
    expect(files).toContain(PROJECT_SERVICE);
    expect(files.length).toBeGreaterThan(1000);
  });

  test("only the files listed name a counter column", () => {
    const naming: Array<string> = files.filter((file: string): boolean => {
      const text: string = read(file);

      return COUNTERS.some((counter: string): boolean => {
        return namesIdentifier(text, counter);
      });
    });

    expect(naming).toEqual(Object.keys(MAY_NAME_A_COUNTER).sort());
  });

  test("the identifier match finds whole names only", () => {
    expect(
      namesIdentifier("const incidentCounterResult = 1;", "incidentCounter"),
    ).toBe(false);
    expect(
      namesIdentifier("select: { incidentCounter: true }", "incidentCounter"),
    ).toBe(true);
    expect(namesIdentifier('"incidentCounter"', "incidentCounter")).toBe(true);
    expect(namesIdentifier("project.alertEpisodeCounter", "alertCounter")).toBe(
      false,
    );
  });

  test.each(NUMBERED_RECORD_KINDS as Array<NumberedRecordKindInfo>)(
    "$kind: its record service numbers its records from its own method, once",
    (info: NumberedRecordKindInfo) => {
      const service: { file: string; method: string; numberColumn: string } =
        RECORD_SERVICES[info.kind];
      const text: string = read(service.file);

      expect(countOf(text, `ProjectService.${service.method}(`)).toBe(1);
      expect(text).toContain(`createBy.data.${service.numberColumn} =`);
    },
  );

  test.each(NUMBERED_RECORD_KINDS as Array<NumberedRecordKindInfo>)(
    "$kind: nothing but its record service calls its method",
    (info: NumberedRecordKindInfo) => {
      const service: { file: string; method: string } =
        RECORD_SERVICES[info.kind];

      const callers: Array<string> = files.filter((file: string): boolean => {
        return (
          file !== PROJECT_SERVICE && read(file).includes(`${service.method}(`)
        );
      });

      expect(callers).toEqual([service.file]);
    },
  );

  test.each(NUMBERED_RECORD_KINDS as Array<NumberedRecordKindInfo>)(
    "$kind: ProjectService's method takes the number with the kind's own statement",
    (info: NumberedRecordKindInfo) => {
      const text: string = read(PROJECT_SERVICE);
      const method: string = RECORD_SERVICES[info.kind].method;
      const start: number = text.indexOf(`public async ${method}(`);

      expect(start).toBeGreaterThan(-1);

      const body: string = text.slice(start, text.indexOf("\n  }\n", start));

      expect(body).toContain("this.takeNextNumber(");
      expect(body).toContain(`NumberedRecordKind.${info.kind}`);
    },
  );

  test("takeNextNumber is one statement that moves the counter to the higher of its next number and the start", () => {
    const text: string = read(PROJECT_SERVICE);
    const start: number = text.indexOf("private async takeNextNumber(");

    expect(start).toBeGreaterThan(-1);

    const body: string = text.slice(start, text.indexOf("\n  }\n", start));

    expect(countOf(body, "repository.manager.query(")).toBe(1);
    expect(body).toContain(
      "SET ${counter} = GREATEST(${counter} + 1, COALESCE(${startsAt}, 0))",
    );
    expect(body).toContain('RETURNING ${counter} AS "counter"');
    expect(body).not.toContain("Semaphore");
  });

  test("ProjectService writes a counter nowhere else", () => {
    const text: string = read(PROJECT_SERVICE);

    for (const counter of COUNTERS) {
      expect({
        counter,
        incremented: text.includes(`columnName: "${counter}"`),
      }).toEqual({ counter, incremented: false });
    }
  });

  test.each(Object.entries(MAY_NAME_A_COUNTER))(
    "%s still names a counter (%s)",
    (file: string) => {
      const text: string = read(file);

      expect(
        COUNTERS.some((counter: string): boolean => {
          return namesIdentifier(text, counter);
        }),
      ).toBe(true);
    },
  );
});
