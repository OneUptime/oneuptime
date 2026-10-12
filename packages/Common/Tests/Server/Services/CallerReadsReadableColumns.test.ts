import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Permission from "../../../Types/Permission";
import { CallerRead, findCallerReads } from "../../Helpers/CallerReadScan";
import { listTypeScriptFiles } from "../../Helpers/ReferenceNameScan";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * SERVER CODE READS WITH A CALLER'S PROPS ONLY COLUMNS THOSE CALLERS MAY READ.
 *
 * A read made through a service with the caller's props - a route's own
 * check, an Ask AI tool acting as the person who asked, a hook acting for
 * whoever made the write - is held to the caller's column permissions:
 * SelectPermission refuses a selected column they may not read,
 * QueryPermission a column the query filters on (for an update or a delete
 * by query too), and a relation's select is refused a column of the related
 * record the relation query never reads. Three ways such a read is refused
 * though the caller may read the record:
 *
 *  1. A column nobody may read - read: [], a secret or a value OneUptime
 *     keeps to itself, or a column that declares no access control at all -
 *     is refused to EVERYONE, the project owner included. An LLM provider's
 *     Test button read isGlobalLlm with the caller's props, and every
 *     member's test was refused:
 *
 *       "You do not have permissions to select on - isGlobalLlm. No
 *        permission allows it: the column is not readable through the API."
 *
 *  2. A column fewer people may read than its table is refused to the rest
 *     of the table's readers. Ask AI's code tools selected a repository's
 *     GitHub App installation, read by its owners, admins and Read Code
 *     Repository alone, and refused every Project Member, Viewer and
 *     settings role the tools are offered to.
 *
 *  3. A relation's select of a related column that is not readable on a
 *     relation query (canReadOnRelationQuery), nor _id or a timestamp, is
 *     refused to everyone. Ask AI's status page tool asked for
 *     monitor.isArchived along with a page's resources.
 *
 * Server administrators never meet any of them - their reads skip every
 * column check - which is how all three shipped. A value the caller may not
 * read is read with OneUptime's own props ({ isRoot: true }), and what the
 * caller is shown is decided from what their own read returned.
 *
 * This is the read side of HookWritesCallersMayMake, which holds the write
 * hooks to the columns their callers may write; together they cover
 * create, update, select and query. The reads are found by
 * Tests/Helpers/CallerReadScan, across Common's server code, the App's
 * feature sets and - when it is there - ee/Server (Common Test runs without
 * ee/).
 */

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");
const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);

const ROOTS: Array<string> = [
  path.join(REPOSITORY, "packages/Common/Server"),
  path.join(REPOSITORY, "packages/App/FeatureSet"),
  path.join(REPOSITORY, "ee/Server"),
];

/*
 * Columns the column checks never ask about (ColumnPermissions
 * .getExcludedColumnNames): every reader of a record reads them.
 */
const ALWAYS_READABLE: Array<string> = [
  "_id",
  "createdAt",
  "deletedAt",
  "updatedAt",
  "version",
];

/*
 * Reads of a column nobody may read that are left as they are, and why.
 * Keyed "<file>#<select|query>#<Model>.<column>". An entry the scan no
 * longer finds fails below: delete it.
 */
const ALLOWED_READS: Record<string, string> = {
  "packages/Common/Server/Services/StatusPageSubscriberService.ts#select#StatusPageSubscriber.slackIncomingWebhookUrl":
    "getSubscribersByStatusPage takes its props from its callers, the notification senders, and every one passes OneUptime's own ({ isRoot: true }): they need the webhook to send to.",
  "packages/Common/Server/Services/StatusPageSubscriberService.ts#select#StatusPageSubscriber.microsoftTeamsIncomingWebhookUrl":
    "getSubscribersByStatusPage takes its props from its callers, the notification senders, and every one passes OneUptime's own ({ isRoot: true }): they need the webhook to send to.",
  "packages/Common/Server/Services/StatusPageSubscriberService.ts#select#StatusPageSubscriber.unsubscribeToken":
    "getSubscribersByStatusPage takes its props from its callers, the notification senders, and every one passes OneUptime's own ({ isRoot: true }): each message carries the subscriber's unsubscribe link.",
};

/*
 * Reads of a column fewer people may read than its table, left as they
 * are, and why: who may make the read, or what it does for the readers it
 * refuses. Keyed like ALLOWED_READS.
 */
const ALLOWED_NARROW_READS: Record<string, string> = {
  "packages/Common/Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiLogsReader.ts#select#RunnerJob.payload":
    "The commands AI ran are read with the reader's props through readIfPermitted: a Viewer, who may read the commands' runs but not what they ran, is shown the rest of the AI log without them - a refusal the reader handles, not one it meets.",
  "packages/Common/Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiLogsReader.ts#select#RunnerJob.script":
    "The commands AI ran are read with the reader's props through readIfPermitted: a Viewer, who may read the commands' runs but not what they ran, is shown the rest of the AI log without them - a refusal the reader handles, not one it meets.",
  "packages/Common/Server/Utils/AI/Toolbox/TeamTools.ts#select#TeamMember.user":
    "The team tool is offered to Team's readers alone (its requiredPermissions), and every one of them may read a member's user: Current User, the one permission the column leaves out, reaches nobody's memberships but the caller's own.",
};

/*
 * Relation selects of a related column the relation query never reads,
 * left as they are, and why. Keyed "<file>#select#<Model>.<relation>.
 * <related column>".
 */
const ALLOWED_RELATION_READS: Record<string, string> = {
  "packages/Common/Server/Services/StatusPageSubscriberService.ts#select#StatusPageSubscriber.statusPageResources.statusPageId":
    "getSubscribersByStatusPage takes its props from its callers, the notification senders, and every one passes OneUptime's own ({ isRoot: true }): they read which resources each subscriber picked.",
};

const models: Map<string, DatabaseBaseModel | null> = new Map();

function loadModel(modelFile: string): DatabaseBaseModel | null {
  if (!models.has(modelFile)) {
    let model: DatabaseBaseModel | null = null;

    try {
      const exported: unknown = (
        jest.requireActual(path.join(MODELS_DIRECTORY, modelFile)) as {
          default?: unknown;
        }
      ).default;

      if (typeof exported === "function") {
        const instance: unknown = new (exported as new () => unknown)();
        model = instance instanceof DatabaseBaseModel ? instance : null;
      }
    } catch {
      model = null;
    }

    models.set(modelFile, model);
  }

  return models.get(modelFile)!;
}

function isOwnColumnRead(read: CallerRead): boolean {
  return (
    read.relatedColumn === undefined && !ALWAYS_READABLE.includes(read.column)
  );
}

/*
 * Nobody may read it through a caller's read: its read list is empty, or it
 * declares no access control at all, which the column checks read the same
 * way.
 */
function readByNobody(read: CallerRead): boolean {
  const model: DatabaseBaseModel | null = loadModel(read.modelFile);

  if (!model || !isOwnColumnRead(read)) {
    return false;
  }

  if (!model.getTableColumns().columns.includes(read.column)) {
    return false;
  }

  const list: unknown = model.getColumnAccessControlFor(read.column)?.read;

  return !Array.isArray(list) || list.length === 0;
}

// The table's readers the column's own read list leaves out.
function readersLeftOut(read: CallerRead): Array<Permission> {
  const model: DatabaseBaseModel | null = loadModel(read.modelFile);

  if (!model || !isOwnColumnRead(read) || readByNobody(read)) {
    return [];
  }

  const columnReaders: Array<Permission> =
    model.getColumnAccessControlFor(read.column)?.read || [];

  return (model.getReadPermissions() || []).filter(
    (permission: Permission): boolean => {
      return !columnReaders.includes(permission);
    },
  );
}

/*
 * A relation's select of a related column that the relation query reads
 * for nobody: not readable on a relation query, and not one every reader
 * of the record reads.
 */
function unreadableOnRelation(read: CallerRead): boolean {
  if (read.relatedColumn === undefined) {
    return false;
  }

  const metadata: TableColumnMetadata | undefined = loadModel(
    read.modelFile,
  )?.getTableColumnMetadata(read.column);

  if (!metadata?.modelType) {
    return false;
  }

  const related: DatabaseBaseModel = new metadata.modelType();
  const relatedMetadata: TableColumnMetadata | undefined =
    related.getTableColumnMetadata(read.relatedColumn);

  return (
    !relatedMetadata?.canReadOnRelationQuery &&
    !ALWAYS_READABLE.includes(read.relatedColumn)
  );
}

function keyOf(read: CallerRead): string {
  const column: string =
    read.relatedColumn === undefined
      ? read.column
      : `${read.column}.${read.relatedColumn}`;

  return `${path.relative(REPOSITORY, read.file)}#${read.kind}#${read.modelFile}.${column}`;
}

function describeRead(read: CallerRead): string {
  return `${keyOf(read)} (line ${read.line}): ${read.text}`;
}

function scan(): Array<CallerRead> {
  const reads: Array<CallerRead> = [];

  for (const root of ROOTS) {
    for (const file of listTypeScriptFiles(root)) {
      if (file.includes(`${path.sep}Tests${path.sep}`)) {
        continue;
      }

      const text: string = fs.readFileSync(file, "utf8");

      if (text.indexOf("props") === -1) {
        continue;
      }

      reads.push(...findCallerReads(file, text));
    }
  }

  return reads;
}

function staleEntries(
  allowed: Record<string, string>,
  found: Array<CallerRead>,
): Array<string> {
  const keys: Set<string> = new Set(found.map(keyOf));

  return Object.keys(allowed).filter((key: string): boolean => {
    return !keys.has(key);
  });
}

describe("reads made with a caller's props", () => {
  const reads: Array<CallerRead> = scan();
  const unreadable: Array<CallerRead> = reads.filter(readByNobody);
  const narrow: Array<CallerRead> = reads.filter((read: CallerRead) => {
    return readersLeftOut(read).length > 0;
  });
  const relationRefused: Array<CallerRead> =
    reads.filter(unreadableOnRelation);

  test("never select or filter by a column nobody may read", () => {
    expect(
      unreadable
        .filter((read: CallerRead): boolean => {
          return !ALLOWED_READS[keyOf(read)];
        })
        .map(describeRead),
    ).toEqual([]);
  });

  test("never select or filter by a column fewer people may read than its table", () => {
    expect(
      narrow
        .filter((read: CallerRead): boolean => {
          return !ALLOWED_NARROW_READS[keyOf(read)];
        })
        .map((read: CallerRead): string => {
          return `${describeRead(read)} - leaves out ${readersLeftOut(
            read,
          ).join(", ")}`;
        }),
    ).toEqual([]);
  });

  test("never ask a relation for a column its relation query does not read", () => {
    expect(
      relationRefused
        .filter((read: CallerRead): boolean => {
          return !ALLOWED_RELATION_READS[keyOf(read)];
        })
        .map(describeRead),
    ).toEqual([]);
  });

  test("every allowed read is still one the code makes", () => {
    expect(staleEntries(ALLOWED_READS, unreadable)).toEqual([]);
    expect(staleEntries(ALLOWED_NARROW_READS, narrow)).toEqual([]);
    expect(staleEntries(ALLOWED_RELATION_READS, relationRefused)).toEqual([]);
  });

  test("every allowed read says why", () => {
    for (const [key, why] of Object.entries({
      ...ALLOWED_READS,
      ...ALLOWED_NARROW_READS,
      ...ALLOWED_RELATION_READS,
    })) {
      expect([key, why.length > 40]).toEqual([key, true]);
    }
  });

  test("the LLM provider's Test reads nothing with the caller's props that they may not read", () => {
    const testReads: Array<CallerRead> = reads.filter(
      (read: CallerRead): boolean => {
        return (
          path.relative(REPOSITORY, read.file) ===
            "packages/Common/Server/API/LlmProviderTestAccess.ts" ||
          path.relative(REPOSITORY, read.file) ===
            "packages/Common/Server/API/LlmProviderAPI.ts"
        );
      },
    );

    expect(
      testReads
        .filter((read: CallerRead): boolean => {
          return (
            readByNobody(read) ||
            readersLeftOut(read).length > 0 ||
            unreadableOnRelation(read)
          );
        })
        .map(describeRead),
    ).toEqual([]);
  });

  test("the scan reads the server's reads: imported services, this, this.service, relations and writes by query", () => {
    expect(reads.length).toBeGreaterThan(1400);

    const has: (
      file: string,
      kind: string,
      column: string,
      relatedColumn?: string,
    ) => boolean = (
      file: string,
      kind: string,
      column: string,
      relatedColumn?: string,
    ): boolean => {
      return reads.some((read: CallerRead): boolean => {
        return (
          path.relative(REPOSITORY, read.file) === file &&
          read.kind === kind &&
          read.column === column &&
          read.relatedColumn === relatedColumn
        );
      });
    };

    // Through an imported service, with the caller's props.
    expect(
      has(
        "packages/Common/Server/Utils/AI/Toolbox/CodeTools.ts",
        "select",
        "repositoryHostedAt",
      ),
    ).toBe(true);
    // Through `this`, inside a service.
    expect(
      has(
        "packages/Common/Server/Services/StatusPageSubscriberService.ts",
        "query",
        "statusPageId",
      ),
    ).toBe(true);
    // Through `this.service`, inside a model's API.
    expect(
      has(
        "packages/Common/Server/API/SecurityEventConnectionAPI.ts",
        "select",
        "projectId",
      ),
    ).toBe(true);
    // A relation's select, column by column.
    expect(
      has(
        "packages/Common/Server/Utils/AI/Toolbox/TeamTools.ts",
        "select",
        "user",
        "email",
      ),
    ).toBe(true);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The scanner, on files of its own.
 * ---------------------------------------------------------------------------
 */

// A file next to the real services, so its imports resolve to them.
const FIXTURE_FILE: string = path.join(
  REPOSITORY,
  "packages/Common/Server/API/Fixture.ts",
);

function readsOf(body: string, header: string = ""): Array<string> {
  const text: string = `
import LlmProviderService from "../Services/LlmProviderService";
import PacketCaptureService from "Common/Server/Services/PacketCaptureService";
${header}
export default class Fixture {
${body}
}
`;

  return findCallerReads(FIXTURE_FILE, text).map((read: CallerRead): string => {
    const column: string =
      read.relatedColumn === undefined
        ? read.column
        : `${read.column}.${read.relatedColumn}`;

    return `${read.method} ${read.kind} ${read.modelFile}.${column}`;
  });
}

describe("findCallerReads", () => {
  test("the columns of the select and the query, on the model of the service read through", () => {
    expect(
      readsOf(`
  public async run(props: DatabaseCommonInteractionProps): Promise<void> {
    await LlmProviderService.findOneBy({
      query: { projectId: id, isGlobalLlm: false },
      select: { _id: true, name: true, project: { name: true } },
      props: props,
    });
  }`),
    ).toEqual([
      "findOneBy select LlmProvider._id",
      "findOneBy select LlmProvider.name",
      "findOneBy select LlmProvider.project",
      "findOneBy select LlmProvider.project.name",
      "findOneBy query LlmProvider.projectId",
      "findOneBy query LlmProvider.isGlobalLlm",
    ]);
  });

  test.each(["findOneById", "findOneBy", "findBy", "findAllBy", "countBy"])(
    "%s is a read",
    (method: string) => {
      expect(
        readsOf(`
  public async run(props: DatabaseCommonInteractionProps): Promise<void> {
    await PacketCaptureService.${method}({ query: { fileId: id }, props: props });
  }`),
      ).toEqual([`${method} query PacketCapture.fileId`]);
    },
  );

  test.each(["updateOneBy", "updateBy", "deleteOneBy", "deleteBy"])(
    "%s reads through its query alone",
    (method: string) => {
      expect(
        readsOf(`
  public async run(props: DatabaseCommonInteractionProps): Promise<void> {
    await PacketCaptureService.${method}({
      query: { fileId: id },
      data: { name: "x" },
      select: { status: true },
      props: props,
    });
  }`),
      ).toEqual([`${method} query PacketCapture.fileId`]);
    },
  );

  test.each([
    ["a parameter", "props", true],
    ["a request's props", "data.props", true],
    ["a literal with only a project", "{ tenantId: projectId }", true],
    ["OneUptime's own", "{ isRoot: true }", false],
    ["a server admin's", "{ isMasterAdmin: true, tenantId: projectId }", false],
    ["a variable set to OneUptime's own", "rootProps", false],
  ])(
    "props that are %s",
    (_what: string, props: string, isCallers: boolean) => {
      expect(
        readsOf(`
  public async run(props: DatabaseCommonInteractionProps, data: { props: DatabaseCommonInteractionProps }): Promise<void> {
    const rootProps: DatabaseCommonInteractionProps = { isRoot: true };
    await PacketCaptureService.findBy({ select: { fileId: true }, props: ${props} });
  }`),
      ).toEqual(isCallers ? ["findBy select PacketCapture.fileId"] : []);
    },
  );

  test("props named alone in the call are the caller's unless the function sets them to OneUptime's own", () => {
    expect(
      readsOf(`
  public async run(props: DatabaseCommonInteractionProps): Promise<void> {
    await PacketCaptureService.findBy({ select: { fileId: true }, props });
  }
  public async asRoot(): Promise<void> {
    const props: DatabaseCommonInteractionProps = { isRoot: true };
    await PacketCaptureService.findBy({ select: { status: true }, props });
  }`),
    ).toEqual(["findBy select PacketCapture.fileId"]);
  });

  test("a variable another function sets to OneUptime's own is not this one's", () => {
    expect(
      readsOf(`
  public async elsewhere(): Promise<void> {
    const rootProps: DatabaseCommonInteractionProps = { isRoot: true };
    await PacketCaptureService.findBy({ select: { status: true }, props: rootProps });
  }
  public async run(rootProps: DatabaseCommonInteractionProps): Promise<void> {
    await PacketCaptureService.findBy({ select: { fileId: true }, props: rootProps });
  }`),
    ).toEqual(["findBy select PacketCapture.fileId"]);
  });

  test("a select or a query the function declares is read where it is declared", () => {
    expect(
      readsOf(`
  public async run(props: DatabaseCommonInteractionProps): Promise<void> {
    const select = { fileId: true, probe: { name: true } };
    const query = { bpfFilter: "tcp" };
    await PacketCaptureService.findBy({ select, query: query, props });
  }`),
    ).toEqual([
      "findBy select PacketCapture.fileId",
      "findBy select PacketCapture.probe",
      "findBy select PacketCapture.probe.name",
      "findBy query PacketCapture.bpfFilter",
    ]);
  });

  test("a select built some other way is not read", () => {
    expect(
      readsOf(`
  public async run(props: DatabaseCommonInteractionProps, select: Select<PacketCapture>): Promise<void> {
    await PacketCaptureService.findBy({ select: select, props });
    await PacketCaptureService.findBy({ select: this.getSelect(), props });
  }`),
    ).toEqual([]);
  });

  test("this.service, in a model's API, reads that model", () => {
    expect(
      readsOf(
        `
  public async run(props: DatabaseCommonInteractionProps): Promise<void> {
    await this.service.findOneBy({ select: { isGlobalLlm: true }, props: props });
  }`,
        `
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import BaseAPI from "./BaseAPI";
export class LlmProviderAPI extends BaseAPI<LlmProvider, LlmProviderServiceType> {}
`,
      ),
    ).toEqual(["findOneBy select LlmProvider.isGlobalLlm"]);
  });

  test("a read with no props, or through what is not a service, is not one", () => {
    expect(
      readsOf(`
  public async run(props: DatabaseCommonInteractionProps): Promise<void> {
    await PacketCaptureService.findBy({ select: { fileId: true } });
    await somethingElse.findBy({ select: { fileId: true }, props: props });
  }`),
    ).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * What the guard calls a refused read, on reads of its own.
 * ---------------------------------------------------------------------------
 */

function read(data: {
  modelFile: string;
  column: string;
  relatedColumn?: string;
  kind?: "select" | "query";
}): CallerRead {
  return {
    file: FIXTURE_FILE,
    line: 1,
    text: "",
    kind: data.kind || "select",
    modelFile: data.modelFile,
    column: data.column,
    ...(data.relatedColumn !== undefined
      ? { relatedColumn: data.relatedColumn }
      : {}),
    method: "findBy",
  };
}

describe("the guard's three refusals", () => {
  test("a column no permission reads is read by nobody, in a select and in a query", () => {
    expect(
      readByNobody(read({ modelFile: "LlmProvider", column: "isGlobalLlm" })),
    ).toBe(true);
    expect(
      readByNobody(
        read({
          modelFile: "LlmProvider",
          column: "isGlobalLlm",
          kind: "query",
        }),
      ),
    ).toBe(true);
    expect(
      readByNobody(read({ modelFile: "LlmProvider", column: "projectId" })),
    ).toBe(false);
  });

  test("a column every reader of the table reads leaves nobody out; a secret leaves the members out", () => {
    expect(
      readersLeftOut(read({ modelFile: "LlmProvider", column: "name" })),
    ).toEqual([]);
    expect(
      readersLeftOut(read({ modelFile: "LlmProvider", column: "apiKey" })),
    ).toEqual(
      expect.arrayContaining([
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadProjectLlm,
      ]),
    );
    expect(
      readersLeftOut(
        read({ modelFile: "CodeRepository", column: "gitHubAppInstallationId" }),
      ),
    ).toEqual(
      expect.arrayContaining([Permission.ProjectMember, Permission.Viewer]),
    );
  });

  test("_id and the timestamps are never refused", () => {
    for (const column of ALWAYS_READABLE) {
      expect(readByNobody(read({ modelFile: "LlmProvider", column }))).toBe(
        false,
      );
      expect(readersLeftOut(read({ modelFile: "LlmProvider", column }))).toEqual(
        [],
      );
    }
  });

  test("a relation's select of a column the relation query does not read is refused; one it reads is not", () => {
    expect(
      unreadableOnRelation(
        read({
          modelFile: "StatusPageResource",
          column: "monitor",
          relatedColumn: "isArchived",
        }),
      ),
    ).toBe(true);
    expect(
      unreadableOnRelation(
        read({
          modelFile: "StatusPageResource",
          column: "monitor",
          relatedColumn: "name",
        }),
      ),
    ).toBe(false);
    expect(
      unreadableOnRelation(
        read({
          modelFile: "StatusPageResource",
          column: "monitor",
          relatedColumn: "_id",
        }),
      ),
    ).toBe(false);
  });
});
