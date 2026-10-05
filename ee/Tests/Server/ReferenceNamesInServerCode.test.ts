import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RelationNames, {
  RelationName,
} from "Common/Server/Utils/Database/RelationNames";
import {
  OneNameRead,
  ScanFinding,
  findOneNameReads,
  findReferenceWrites,
  findSingleNameReads,
  listTypeScriptFiles,
  modelFileOf,
} from "Common/Tests/Helpers/ReferenceNameScan";

/*
 * The reference-name guards, over ee/Server.
 *
 * A record's reference has two names a write can use - the relation
 * (`team`) and its ID column (`teamId`) - and they are one database column.
 * Core's guards hold packages/Common/Server to reading both together and to
 * writing a reference a hook decides with RelationIdUtil.stamp
 * (Common/Tests/Server/Utils/Database/ReferenceNamesReadTogether and
 * Common/Tests/Server/Services/HookReferenceWritesUseStamp). The Common test
 * job runs without ee/, so the same detectors (Common/Tests/Helpers/
 * ReferenceNameScan) run over ee/Server here:
 *
 *   - no code reads one name of a reference with the other as a fallback;
 *   - a database service of ee/Server, were there one, reads a reference of
 *     a write under both names and writes one it decides with stamp.
 *
 * ee/Server has no database service of its own today: the Enterprise areas
 * call core's services. The other guards over services - hook writes after
 * the permission check, project-scoped references - read
 * packages/Common/Server/Services only, so a database service added here is
 * stopped below until those guards read ee/Server as well.
 */

const EE_SERVER_DIRECTORY: string = path.resolve(__dirname, "../../Server");
const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../packages/Common/Models/DatabaseModels",
);

const files: Array<string> = listTypeScriptFiles(EE_SERVER_DIRECTORY);

function relative(file: string): string {
  return path.relative(EE_SERVER_DIRECTORY, file);
}

// A service of one database model: the model it extends a service of.
function isDatabaseService(text: string): boolean {
  return (
    Boolean(modelFileOf(text)) ||
    /extends\s+(DatabaseService|ProjectReferencesService)\s*</.test(text)
  );
}

function referencesOf(modelFile: string): Array<RelationName> {
  const exported: unknown = (
    jest.requireActual(path.join(MODELS_DIRECTORY, modelFile)) as {
      default?: unknown;
    }
  ).default;

  if (typeof exported !== "function") {
    return [];
  }

  const model: unknown = new (exported as new () => unknown)();

  return model instanceof DatabaseBaseModel
    ? RelationNames.getSingleRelations(model)
    : [];
}

describe("ee/Server reads both names of a reference together", () => {
  test("the scan reads ee/Server", () => {
    // A scan that read nothing would pass everything below.
    expect(files.length).toBeGreaterThan(30);
    expect(files.map(relative)).toContain(path.join("Identity", "API", "SCIM.ts"));
  });

  test("no code reads one name of a reference with the other as a fallback", () => {
    const found: Array<string> = files.flatMap((file: string) => {
      return findSingleNameReads(
        relative(file),
        fs.readFileSync(file, "utf8"),
      ).map((read: ScanFinding): string => {
        return `${read.file}:${read.line}  ${read.text}`;
      });
    });

    expect(found).toEqual([]);
  });

  test("every database service reads a reference under both names and writes one with stamp", () => {
    const found: Array<string> = [];

    for (const file of files) {
      const text: string = fs.readFileSync(file, "utf8");
      const modelFile: string | null = modelFileOf(text);

      if (!modelFile) {
        continue;
      }

      const references: Array<RelationName> = referencesOf(modelFile);

      for (const read of findOneNameReads(relative(file), text, references)) {
        const oneNameRead: OneNameRead = read;
        found.push(
          `${oneNameRead.file}:${oneNameRead.line} ${oneNameRead.functionName} reads ${oneNameRead.name} but never ${oneNameRead.otherName}`,
        );
      }

      for (const write of findReferenceWrites(
        relative(file),
        text,
        new Set(
          references.map((reference: RelationName): string => {
            return reference.idColumn;
          }),
        ),
      )) {
        found.push(`${write.file}:${write.line} ${write.text}`);
      }
    }

    expect(found).toEqual([]);
  });

  test("ee/Server has no database service the core service guards do not read", () => {
    expect(
      files
        .filter((file: string): boolean => {
          return isDatabaseService(fs.readFileSync(file, "utf8"));
        })
        .map(relative),
    ).toEqual([]);
  });
});

describe("the detectors read ee's import style", () => {
  const SERVICE: string = [
    'import Model from "Common/Models/DatabaseModels/TeamComplianceSetting";',
    'import DatabaseService from "Common/Server/Services/DatabaseService";',
    "export class Service extends DatabaseService<Model> {",
    "  protected override async onBeforeCreate(createBy: CreateBy<Model>) {",
    "    await check(createBy.data.teamId);",
    "    createBy.data.teamId = createBy.props.tenantId;",
    "    return { createBy, carryForward: null };",
    "  }",
    "}",
  ].join("\n");

  test("a service is known by the model it imports through Common/", () => {
    expect(modelFileOf(SERVICE)).toBe("TeamComplianceSetting");
    expect(isDatabaseService(SERVICE)).toBe(true);
  });

  test("its reads of one name and its writes are found", () => {
    const references: Array<RelationName> = referencesOf(
      "TeamComplianceSetting",
    );

    expect(
      references.map((reference: RelationName): string => {
        return reference.idColumn;
      }),
    ).toContain("teamId");

    expect(
      findOneNameReads("Service.ts", SERVICE, references).map(
        (read: OneNameRead): string => {
          return read.name;
        },
      ),
    ).toEqual(["teamId"]);

    expect(
      findReferenceWrites("Service.ts", SERVICE, new Set(["teamId"])),
    ).toHaveLength(1);
  });

  test("a module that only calls core's services is not one", () => {
    expect(
      isDatabaseService(
        'import TeamService from "Common/Server/Services/TeamService";\nexport default class TeamComplianceService {}',
      ),
    ).toBe(false);
  });
});
