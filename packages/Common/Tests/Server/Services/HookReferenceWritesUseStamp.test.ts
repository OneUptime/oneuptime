import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RelationNames, {
  RelationName,
} from "../../../Server/Utils/Database/RelationNames";
import {
  ScanFinding,
  findReferenceWrites,
  modelFileOf,
} from "../../Helpers/ReferenceNameScan";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * A hook that decides a reference itself - the person a record is created
 * by, the state it starts in, a default it fills in, the id it has just
 * checked - writes it with RelationIdUtil.stamp, never by assigning the ID
 * column. The relation and its ID column are one database column, and when
 * a write carries both TypeORM stores the relation's id
 * (RelationNamePrecedence.test.ts). So `createBy.data.monitorId = id` leaves
 * a `monitor` the caller sent beside it to be stored in its place, where
 * stamp writes the ID column and removes every other name of it.
 *
 * DatabaseService refuses a write whose two names disagree before any hook
 * runs (RelationNames), so a hook only ever sees one value. This holds the
 * other half: what a hook writes is what is stored. It scans every service
 * in Common/Server/Services for an assignment to, or a setColumnValue of,
 * one of its own model's reference ID columns on the payload a create or
 * update hook is handed. The tenant column is DatabaseService's own
 * (enforceTenantRelationMatchesScalar), and RelationNames leaves it out.
 *
 * The detector is findReferenceWrites (Tests/Helpers/ReferenceNameScan.ts);
 * ee/Tests/Server/ReferenceNamesInServerCode runs it over ee/Server.
 */

const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);
const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);

// The ID columns of the model's references, the tenant's left out.
function idColumnsOf(modelFile: string): Set<string> {
  const exported: unknown = (
    jest.requireActual(path.join(MODELS_DIRECTORY, modelFile)) as {
      default?: unknown;
    }
  ).default;

  if (typeof exported !== "function") {
    return new Set();
  }

  let model: unknown;

  try {
    model = new (exported as new () => unknown)();
  } catch {
    return new Set();
  }

  if (!(model instanceof DatabaseBaseModel)) {
    return new Set();
  }

  return new Set(
    RelationNames.getSingleRelations(model).map(
      (relation: RelationName): string => {
        return relation.idColumn;
      },
    ),
  );
}

interface ScannedService {
  file: string;
  idColumns: Set<string>;
}

function scanServices(): {
  services: Array<ScannedService>;
  writes: Array<ScanFinding>;
} {
  const services: Array<ScannedService> = [];
  const writes: Array<ScanFinding> = [];

  for (const file of fs.readdirSync(SERVICES_DIRECTORY).sort()) {
    if (!file.endsWith(".ts")) {
      continue;
    }

    const text: string = fs.readFileSync(
      path.join(SERVICES_DIRECTORY, file),
      "utf8",
    );
    const modelFile: string | null = modelFileOf(text);

    if (!modelFile) {
      continue;
    }

    const idColumns: Set<string> = idColumnsOf(modelFile);

    if (idColumns.size === 0) {
      continue;
    }

    services.push({ file: file, idColumns: idColumns });
    writes.push(...findReferenceWrites(file, text, idColumns));
  }

  return { services: services, writes: writes };
}

describe("a hook writes a reference it decides with RelationIdUtil.stamp", () => {
  const scan: {
    services: Array<ScannedService>;
    writes: Array<ScanFinding>;
  } = scanServices();

  test("no service assigns one of its model's reference ID columns on a write's payload", () => {
    expect(scan.writes).toEqual([]);
  });

  test("the scan reads the services that write references", () => {
    const scanned: Map<string, Set<string>> = new Map(
      scan.services.map((service: ScannedService): [string, Set<string>] => {
        return [service.file, service.idColumns];
      }),
    );

    expect(scan.services.length).toBeGreaterThan(100);
    expect(
      scanned.get("IncidentService.ts")?.has("currentIncidentStateId"),
    ).toBe(true);
    expect(scanned.get("AlertService.ts")?.has("currentAlertStateId")).toBe(
      true,
    );
    expect(scanned.get("ProjectService.ts")?.has("createdByUserId")).toBe(true);
    expect(scanned.get("UserTotpAuthService.ts")?.has("userId")).toBe(true);
    // The tenant column is DatabaseService's own.
    expect(scanned.get("IncidentService.ts")?.has("projectId")).toBe(false);
  });
});

describe("findReferenceWrites", () => {
  const ID_COLUMNS: Set<string> = new Set(["monitorId", "createdByUserId"]);

  const WRITES: Array<[string, string]> = [
    ["an assignment on a create's payload", "createBy.data.monitorId = id;"],
    ["a clear on an update's payload", "updateBy.data.monitorId = null;"],
    ["an element assignment", 'createBy.data["monitorId"] = id;'],
    ["a cast payload", "(createBy.data as any).monitorId = id;"],
    [
      "an alias of the payload",
      "const data: Record<string, unknown> = createBy.data as unknown as Record<string, unknown>;\ndata.monitorId = id;",
    ],
    [
      "an alias of an alias",
      "const payload = createBy.data;\nconst data = payload;\ndata.monitorId = id;",
    ],
    [
      "setColumnValue on the payload",
      'createBy.data.setColumnValue("monitorId", id);',
    ],
    [
      "a hook whose argument is named data",
      "data.data.createdByUserId = data.props.userId;",
    ],
  ];

  const NOT_WRITES: Array<[string, string]> = [
    [
      "stamp",
      'RelationIdUtil.stamp(createBy.data, ["monitorId", "monitor"], id);',
    ],
    ["another column", 'createBy.data.name = "Core Switch";'],
    ["a column of another object", "query.monitorId = id;"],
    ["a new record", "const row: Model = new Model();\nrow.monitorId = id;"],
    ["a read", "const id: ObjectID = createBy.data.monitorId;"],
    ["a comparison", "if (createBy.data.monitorId === id) {\n}"],
    ["a column the scan was not given", "createBy.data.projectId = id;"],
    ["a delete", "delete createBy.data.monitorId;"],
  ];

  test.each(WRITES)("found: %s", (_shape: string, code: string) => {
    expect(findReferenceWrites("x.ts", code, ID_COLUMNS)).toHaveLength(1);
  });

  test.each(NOT_WRITES)("not found: %s", (_shape: string, code: string) => {
    expect(findReferenceWrites("x.ts", code, ID_COLUMNS)).toEqual([]);
  });
});
