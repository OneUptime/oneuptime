import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RelationNames, {
  RelationName,
} from "../../../../Server/Utils/Database/RelationNames";
import {
  OneNameRead,
  ReferenceNamePair,
  ScanFinding,
  findOneNameReads,
  findSingleNameReads,
  listTypeScriptFiles,
  modelFileOf,
} from "../../../Helpers/ReferenceNameScan";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * A reference has two names a write can use - the relation (`monitor`) and
 * its ID column (`monitorId`) - and they are one database column. When a
 * write carries both, TypeORM stores the relation's id
 * (RelationNamePrecedence.test.ts). So server code that checks or acts on a
 * reference of a write reads both names, through
 * RelationIdUtil.readConsistent (or readIntoIdColumn, or
 * getWrittenRelationReferences, built on it), which refuses a write whose two
 * names disagree. Two ways of reading it are held out here:
 *
 *   - one name, with the other as a fallback (findSingleNameReads):
 *       resolveReferenceId(data.monitorId) || resolveReferenceId(data.monitor)
 *       createBy.data.domainId?.toString() || createBy.data.domain?._id
 *     The first name that holds an id is read: a write naming one record
 *     under one name and another record under the other has the first
 *     checked and the second stored. Scanned over all of packages/Common/
 *     Server; ee/Server is scanned by its twin in ee/Tests.
 *
 *   - one name alone (findOneNameReads): a hook that reads
 *     `createBy.data.statusPageId` and never `statusPage` misses every write
 *     that names the page by the relation - a duplicate check finds nothing,
 *     a quota counts no release, a parent goes unchecked, a list is ordered
 *     without its group. Scanned over every service of a model.
 *
 * The detectors live in Tests/Helpers/ReferenceNameScan.ts.
 */

const SERVER_DIRECTORY: string = path.resolve(__dirname, "../../../../Server");
const SERVICES_DIRECTORY: string = path.join(SERVER_DIRECTORY, "Services");
const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../Models/DatabaseModels",
);

describe("the scan sees every shape of a single-name read", () => {
  const SHAPES: Array<[string, string]> = [
    [
      "resolveReferenceId(ID column) || resolveReferenceId(relation)",
      "const id = resolveReferenceId(updateBy.data.incidentSeverityId) || resolveReferenceId(updateBy.data.incidentSeverity);",
    ],
    [
      "the relation first",
      "const id = resolveReferenceId(data.monitor) || resolveReferenceId(data.monitorId);",
    ],
    [
      "?? in place of ||",
      "const id = resolveReferenceId(data.monitorId) ?? resolveReferenceId(data.monitor);",
    ],
    [
      "bracket access",
      'const id = resolveReferenceId(data["changeMonitorStatusToId"]) || resolveReferenceId(data["changeMonitorStatusTo"]);',
    ],
    [
      "the fallback inside the call",
      "const id = resolveReferenceId(createBy.data.statusPageId || createBy.data.statusPage);",
    ],
    [
      "a write's payload read through the relation's id",
      "const id = createBy.data.teamId || createBy.data.team?.id;",
    ],
    [
      "an update's payload, cast",
      'const id = (updateBy.data as Record<string, unknown>)["statusPageGroupId"] || (updateBy.data as Record<string, unknown>)["statusPageGroup"];',
    ],
    [
      "a success hook's payload",
      "const id = onUpdate.updateBy.data.currentIncidentStateId || onUpdate.updateBy.data.currentIncidentState;",
    ],
    [
      "RelationIdUtil.read with the two names",
      'const id = RelationIdUtil.read(data, ["siteId", "site"]);',
    ],
    [
      "RelationIdUtil.read with a constant holding them",
      'const SITE_KEYS: Array<string> = ["siteId", "site"];\nconst id = RelationIdUtil.read(data, SITE_KEYS);',
    ],
    [
      "the two names as text",
      'const id = createBy.data.domainId?.toString() || createBy.data.domain?._id || "";',
    ],
    [
      "any helper of one argument, given each name",
      "const id = toTargetObjectID(data.monitorId) || toTargetObjectID(data.monitor);",
    ],
    [
      "a qualified helper",
      "const id = MeasurementStateReference.getId(data.stateId) || MeasurementStateReference.getId(data.state);",
    ],
  ];

  test.each(SHAPES)("%s", (_shape: string, code: string) => {
    expect(findSingleNameReads("Shape.ts", code)).toHaveLength(1);
  });

  const NOT_SINGLE_NAME_READS: Array<[string, string]> = [
    [
      "readConsistent",
      'const id = RelationIdUtil.readConsistent(data, ["siteId", "site"], "Site");',
    ],
    [
      "a stored row read back",
      "const id = createdItem.createdByUserId || createdItem.createdByUser?.id;",
    ],
    [
      "two different references",
      "const id = resolveReferenceId(data.monitorId) || resolveReferenceId(data.probe);",
    ],
    [
      "the requester before the payload",
      "const id = createBy.props.userId || createBy.data.createdByUserId;",
    ],
    ["one name read alone", 'const id = RelationIdUtil.read(data, ["entry"]);'],
    [
      "a model's own id",
      'const id = RelationIdUtil.read(monitor, ["_id", "id"]);',
    ],
    [
      "two helpers, one for each name",
      "const id = toObjectID(data.monitorId) || toIdString(data.monitor);",
    ],
    [
      "one helper given the names of two objects",
      "const id = toObjectID(first.monitorId) || toObjectID(second.monitor);",
    ],
  ];

  test.each(NOT_SINGLE_NAME_READS)(
    "not flagged: %s",
    (_shape: string, code: string) => {
      expect(findSingleNameReads("Shape.ts", code)).toEqual([]);
    },
  );
});

describe("server code reads both names of a reference together", () => {
  const files: Array<string> = listTypeScriptFiles(SERVER_DIRECTORY);

  test("the scan reads the services", () => {
    // A scan that read nothing would pass everything below.
    expect(files.length).toBeGreaterThan(500);
    expect(
      files.some((file: string): boolean => {
        return file.endsWith(path.join("Services", "IncidentService.ts"));
      }),
    ).toBe(true);
  });

  test("no check or decision reads one name with the other as a fallback", () => {
    const found: Array<string> = files.flatMap((file: string) => {
      return findSingleNameReads(
        path.relative(SERVER_DIRECTORY, file),
        fs.readFileSync(file, "utf8"),
      ).map((read: ScanFinding): string => {
        return `${read.file}:${read.line}  ${read.text}`;
      });
    });

    expect(found).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * One name alone.
 * ---------------------------------------------------------------------------
 */

const REFERENCES: Array<ReferenceNamePair> = [
  { idColumn: "statusPageId", relation: "statusPage" },
  { idColumn: "parentStatusPageGroupId", relation: "parentStatusPageGroup" },
  { idColumn: "userId", relation: "user" },
];

function namesRead(code: string): Array<string> {
  return findOneNameReads("Shape.ts", code, REFERENCES).map(
    (read: OneNameRead): string => {
      return read.name;
    },
  );
}

describe("the scan sees a reference read under one name alone", () => {
  const ONE_NAME: Array<[string, string, Array<string>]> = [
    [
      "a create hook's check",
      "class S { async onBeforeCreate(createBy: CreateBy<M>) { if (createBy.data.statusPageId) { await check(createBy.data.statusPageId); } } }",
      ["statusPageId", "statusPageId"],
    ],
    [
      "an update hook, bracket access through a cast",
      'class S { async onBeforeUpdate(updateBy: UpdateBy<M>) { const v = (updateBy.data as any)["parentStatusPageGroupId"]; } }',
      ["parentStatusPageGroupId"],
    ],
    [
      "the relation alone, through its id",
      "class S { async onBeforeCreate(createBy: CreateBy<M>) { const id = createBy.data.statusPage?._id; } }",
      ["statusPage"],
    ],
    [
      "a hook whose argument is named data",
      "class S { async onBeforeCreate(data: CreateBy<M>) { log(data.data.statusPageId?.toString()); } }",
      ["statusPageId"],
    ],
    [
      "a name the hook gives the payload",
      "class S { async onBeforeCreate(createBy: CreateBy<M>) { const payload = createBy.data as unknown as Record<string, unknown>; use(payload.statusPageId); } }",
      ["statusPageId"],
    ],
    [
      "a helper handed the create",
      "class S { private async check(createBy: CreateBy<M>) { return count({ statusPageId: createBy.data.statusPageId }); } }",
      ["statusPageId"],
    ],
    [
      "a success hook reading the payload",
      "class S { async onCreateSuccess(onCreate: OnCreate<M>, created: M) { refresh(onCreate.createBy.data.userId); } }",
      ["userId"],
    ],
    [
      "a read before the check that refuses an empty ID column",
      'class S { async onBeforeCreate(createBy: CreateBy<M>) { log(createBy.data.statusPageId); if (!createBy.data.statusPageId) { throw new Error("required"); } } }',
      ["statusPageId"],
    ],
  ];

  test.each(ONE_NAME)(
    "%s",
    (_shape: string, code: string, expected: Array<string>) => {
      expect(namesRead(code)).toEqual(expected);
    },
  );

  const BOTH_NAMES_OR_SETTLED: Array<[string, string]> = [
    [
      "readConsistent",
      'class S { async onBeforeCreate(createBy: CreateBy<M>) { const id = RelationIdUtil.readConsistent(createBy.data as any, ["statusPageId", "statusPage"], "Status Page"); } }',
    ],
    [
      "both names handed to a validator",
      "class S { async onBeforeCreate(createBy: CreateBy<M>) { await validate([createBy.data.userId, createBy.data.user]); } }",
    ],
    [
      "the ID column after readIntoIdColumn",
      'class S { async onBeforeCreate(createBy: CreateBy<M>) { RelationIdUtil.readIntoIdColumn(createBy.data as any, ["statusPageId", "statusPage"], "Status Page"); await count({ statusPageId: createBy.data.statusPageId }); } }',
    ],
    [
      "the ID column after readIntoIdColumn with a constant of the names",
      'const KEYS: Array<string> = ["statusPageId", "statusPage"];\nclass S { async onBeforeCreate(createBy: CreateBy<M>) { RelationIdUtil.readIntoIdColumn(createBy.data as any, KEYS, "Status Page"); use(createBy.data.statusPageId); } }',
    ],
    [
      "the ID column after stamp",
      'class S { async onBeforeCreate(createBy: CreateBy<M>) { RelationIdUtil.stamp(createBy.data as any, ["userId", "user"], id); use(createBy.data.userId); } }',
    ],
    [
      "the ID column after a check that refuses it empty",
      'class S { async onBeforeCreate(createBy: CreateBy<M>) { if (!createBy.data.statusPageId) { throw new BadDataException("required"); } await count({ statusPageId: createBy.data.statusPageId }); } }',
    ],
    [
      "the same check among others",
      'class S { async onBeforeCreate(createBy: CreateBy<M>) { if (!createBy.data.email || !createBy.data.statusPageId) { log("missing"); throw new BadDataException("required"); } use(createBy.data.statusPageId); } }',
    ],
    [
      "the same check inside a try whose catch throws again",
      'class S { async onBeforeCreate(createBy: CreateBy<M>) { try { if (!createBy.data.statusPageId) { throw new BadDataException("x"); } use(createBy.data.statusPageId); } catch (err) { release(); throw err; } } }',
    ],
    [
      "a stored row",
      "class S { async onCreateSuccess(onCreate: OnCreate<M>, createdItem: M) { use(createdItem.statusPageId); } }",
    ],
    [
      "an assignment and a delete, which are writes",
      "class S { async onBeforeCreate(createBy: CreateBy<M>) { createBy.data.statusPageId = id; delete createBy.data.statusPage; } }",
    ],
    [
      "another object's column",
      "class S { async onBeforeCreate(createBy: CreateBy<M>) { use(query.statusPageId); } }",
    ],
  ];

  test.each(BOTH_NAMES_OR_SETTLED)(
    "not flagged: %s",
    (_shape: string, code: string) => {
      expect(namesRead(code)).toEqual([]);
    },
  );

  test("a settling call only covers what comes after it, in its own function", () => {
    expect(
      namesRead(
        'class S { async onBeforeCreate(createBy: CreateBy<M>) { use(createBy.data.statusPageId); RelationIdUtil.readIntoIdColumn(createBy.data as any, ["statusPageId", "statusPage"], "x"); } async onBeforeUpdate(updateBy: UpdateBy<M>) { use(updateBy.data.statusPageId); } }',
      ),
    ).toEqual(["statusPageId", "statusPageId"]);
  });

  test("a check that does not always throw settles nothing", () => {
    expect(
      namesRead(
        'class S { async onBeforeCreate(createBy: CreateBy<M>) { if (!createBy.data.statusPageId) { log("none"); } use(createBy.data.statusPageId); } }',
      ),
    ).toEqual(["statusPageId", "statusPageId"]);
  });

  test("a check inside a try whose catch swallows the throw settles nothing", () => {
    expect(
      namesRead(
        'class S { async onBeforeCreate(createBy: CreateBy<M>) { try { if (!createBy.data.statusPageId) { throw new Error("x"); } } catch (err) { log(err); } use(createBy.data.statusPageId); } }',
      ),
    ).toEqual(["statusPageId", "statusPageId"]);
  });
});

describe("the scan knows which model a service serves", () => {
  test.each([
    [
      "a core service, importing the model relatively",
      'import Model from "../../Models/DatabaseModels/StatusPageGroup";\nexport class Service extends ProjectReferencesService<Model> {}',
      "StatusPageGroup",
    ],
    [
      "an ee service, importing the model through the package",
      'import Team from "Common/Models/DatabaseModels/Team";\nexport class Service extends DatabaseService<Team> {}',
      "Team",
    ],
    [
      "a model in a folder",
      'import Model from "../../Models/DatabaseModels/Workspace/WorkspaceSetting";\nclass Service extends DatabaseService<Model> {}',
      "Workspace/WorkspaceSetting",
    ],
  ])("%s", (_shape: string, code: string, expected: string) => {
    expect(modelFileOf(code)).toBe(expected);
  });

  test.each([
    [
      "a class named only in a comment",
      'import Team from "Common/Models/DatabaseModels/Team";\n/* It used to be `class TeamAPI extends BaseAPI<Team>`. */\nexport const router: unknown = null;',
    ],
    [
      "a type argument that is not a model",
      'import Model from "../../Types/Something";\nexport class Service extends DatabaseService<Model> {}',
    ],
    ["no class at all", "export const value: number = 1;"],
  ])("none for %s", (_shape: string, code: string) => {
    expect(modelFileOf(code)).toBeNull();
  });
});

/*
 * A read of one name alone that is right where it is, and why. The list may
 * only shrink: an entry that no longer matches a read fails below, so it is
 * removed with the reason it stood for.
 */
interface OneNameReadKept {
  file: string;
  functionName: string;
  name: string;
  reason: string;
}

const ONE_NAME_READS_KEPT: Array<OneNameReadKept> = [
  {
    file: "IncidentService.ts",
    functionName: "onBeforeCreate",
    name: "incidentSeverityId",
    reason:
      "Drops an ID column that holds an empty id (a stored template's severity deserializes to one) before the severity is read under both of its names, so the empty id is not taken for a clear beside a relation. It reads the column's own value, not the reference.",
  },
];

// The single references of the model a service file serves, by its file name.
function referencesOf(modelFile: string): Array<RelationName> {
  const exported: unknown = (
    jest.requireActual(path.join(MODELS_DIRECTORY, modelFile)) as {
      default?: unknown;
    }
  ).default;

  if (typeof exported !== "function") {
    return [];
  }

  let model: unknown;

  try {
    model = new (exported as new () => unknown)();
  } catch {
    return [];
  }

  if (!(model instanceof DatabaseBaseModel)) {
    return [];
  }

  return RelationNames.getSingleRelations(model);
}

interface ScannedService {
  file: string;
  references: Array<RelationName>;
}

function scanServices(): {
  services: Array<ScannedService>;
  reads: Array<OneNameRead>;
} {
  const services: Array<ScannedService> = [];
  const reads: Array<OneNameRead> = [];

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

    const references: Array<RelationName> = referencesOf(modelFile);

    if (references.length === 0) {
      continue;
    }

    services.push({ file: file, references: references });
    reads.push(...findOneNameReads(file, text, references));
  }

  return { services: services, reads: reads };
}

function isKept(read: OneNameRead): boolean {
  return ONE_NAME_READS_KEPT.some((kept: OneNameReadKept): boolean => {
    return (
      kept.file === read.file &&
      kept.functionName === read.functionName &&
      kept.name === read.name
    );
  });
}

describe("a hook reads a reference of a write under both of its names", () => {
  const scan: { services: Array<ScannedService>; reads: Array<OneNameRead> } =
    scanServices();

  test("the scan reads the services whose hooks check references", () => {
    const scanned: Map<string, Array<string>> = new Map(
      scan.services.map((service: ScannedService): [string, Array<string>] => {
        return [
          service.file,
          service.references.map((reference: RelationName): string => {
            return reference.idColumn;
          }),
        ];
      }),
    );

    expect(scan.services.length).toBeGreaterThan(100);
    expect(scanned.get("StatusPageGroupService.ts")).toContain(
      "parentStatusPageGroupId",
    );
    expect(scanned.get("StatusPageResourceService.ts")).toContain(
      "statusPageGroupId",
    );
    expect(scanned.get("StatusPagePrivateUserService.ts")).toContain(
      "statusPageId",
    );
    expect(scanned.get("IoTDeviceCredentialService.ts")).toContain(
      "iotFleetId",
    );
    expect(scanned.get("TelemetrySourceMapService.ts")).toContain("serviceId");
    // The tenant column is DatabaseService's own.
    expect(scanned.get("StatusPageGroupService.ts")).not.toContain(
      "projectId",
    );
  });

  test("no hook reads one name of a reference alone", () => {
    expect(
      scan.reads
        .filter((read: OneNameRead): boolean => {
          return !isKept(read);
        })
        .map((read: OneNameRead): string => {
          return `${read.file}:${read.line} ${read.functionName} reads ${read.name} but never ${read.otherName}: ${read.text}`;
        }),
    ).toEqual([]);
  });

  test("every read kept on one name still happens, and says why", () => {
    for (const kept of ONE_NAME_READS_KEPT) {
      expect(kept.reason.length).toBeGreaterThan(40);
      expect([
        kept.file,
        kept.functionName,
        kept.name,
        scan.reads.some((read: OneNameRead): boolean => {
          return (
            read.file === kept.file &&
            read.functionName === kept.functionName &&
            read.name === kept.name
          );
        }),
      ]).toEqual([kept.file, kept.functionName, kept.name, true]);
    }
  });
});
