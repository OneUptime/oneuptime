import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { CallerRead, findCallerReads } from "../../Helpers/CallerReadScan";
import { listTypeScriptFiles } from "../../Helpers/ReferenceNameScan";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * SERVER CODE READS WITH A CALLER'S PROPS ONLY COLUMNS SOMEONE MAY READ.
 *
 * A read made through a service with the caller's props - a route's own
 * check, a hook acting for whoever made the write - is held to the
 * caller's column permissions: SelectPermission refuses a selected column
 * they may not read, QueryPermission a column the query filters on. A
 * column no permission reads (read: [], a secret or a value OneUptime keeps
 * to itself) is refused that way for EVERYONE, the project owner included:
 *
 *   "You do not have permissions to select on - isGlobalLlm. No permission
 *    allows it: the column is not readable through the API."
 *
 * - an LLM provider's Test button, for its own project. This is the read
 * side of HookWritesCallersMayMake, which holds the write hooks to the
 * columns their callers may write; together they cover create, update,
 * select and query. A column nobody may read is read with OneUptime's own
 * props ({ isRoot: true }), and what the caller may see is decided from what
 * that read returns.
 *
 * The reads are found by Tests/Helpers/CallerReadScan, across Common's
 * server code, the App's feature sets and - when it is there - ee/Server
 * (Common Test runs without ee/).
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
 * Reads of a column nobody may read that are left as they are, and why.
 * Keyed "<file>#<select|query>#<Model>.<column>". An entry the scan no
 * longer finds fails below: delete it.
 */
const ALLOWED_READS: Record<string, string> = {
  "packages/Common/Server/API/LlmProviderAPI.ts#select#LlmProvider.isGlobalLlm":
    "A live bug, the next to be fixed: the Test button's access check reads isGlobalLlm with the caller's props, so testing a provider is refused for everyone. Fixed by the task llm-provider-test-permission-error, which deletes this entry.",
  "packages/Common/Server/Services/StatusPageSubscriberService.ts#select#StatusPageSubscriber.slackIncomingWebhookUrl":
    "getSubscribersByStatusPage takes its props from its callers, the notification senders, and every one passes OneUptime's own ({ isRoot: true }): they need the webhook to send to.",
  "packages/Common/Server/Services/StatusPageSubscriberService.ts#select#StatusPageSubscriber.microsoftTeamsIncomingWebhookUrl":
    "getSubscribersByStatusPage takes its props from its callers, the notification senders, and every one passes OneUptime's own ({ isRoot: true }): they need the webhook to send to.",
  "packages/Common/Server/Services/StatusPageSubscriberService.ts#select#StatusPageSubscriber.unsubscribeToken":
    "getSubscribersByStatusPage takes its props from its callers, the notification senders, and every one passes OneUptime's own ({ isRoot: true }): each message carries the subscriber's unsubscribe link.",
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

function readByNobody(read: CallerRead): boolean {
  const list: unknown = loadModel(read.modelFile)?.getColumnAccessControlFor(
    read.column,
  )?.read;

  return Array.isArray(list) && list.length === 0;
}

function keyOf(read: CallerRead): string {
  return `${path.relative(REPOSITORY, read.file)}#${read.kind}#${read.modelFile}.${read.column}`;
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

describe("reads made with a caller's props", () => {
  const reads: Array<CallerRead> = scan();
  const unreadable: Array<CallerRead> = reads.filter(readByNobody);

  test("never select or filter by a column nobody may read", () => {
    expect(
      unreadable
        .filter((read: CallerRead): boolean => {
          return !ALLOWED_READS[keyOf(read)];
        })
        .map((read: CallerRead): string => {
          return `${keyOf(read)} (line ${read.line}): ${read.text}`;
        }),
    ).toEqual([]);
  });

  test("every allowed read is still one the code makes", () => {
    const found: Set<string> = new Set(unreadable.map(keyOf));

    for (const key of Object.keys(ALLOWED_READS)) {
      expect([key, found.has(key)]).toEqual([key, true]);
    }
  });

  test("the scan reads the server's reads, through imported services and this", () => {
    expect(reads.length).toBeGreaterThan(800);

    const has: (file: string, kind: string, column: string) => boolean = (
      file: string,
      kind: string,
      column: string,
    ): boolean => {
      return reads.some((read: CallerRead): boolean => {
        return (
          path.relative(REPOSITORY, read.file) === file &&
          read.kind === kind &&
          read.column === column
        );
      });
    };

    // Through an imported service, with the request's props.
    expect(
      has(
        "packages/Common/Server/API/LlmProviderAPI.ts",
        "select",
        "projectId",
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

function readsOf(body: string): Array<string> {
  const text: string = `
import LlmProviderService from "../Services/LlmProviderService";
import PacketCaptureService from "Common/Server/Services/PacketCaptureService";

export default class Fixture {
${body}
}
`;

  return findCallerReads(FIXTURE_FILE, text).map((read: CallerRead): string => {
    return `${read.method} ${read.kind} ${read.modelFile}.${read.column}`;
  });
}

describe("findCallerReads", () => {
  test("the top-level columns of the select and the query, on the model of the service read through", () => {
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
