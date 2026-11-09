import fs from "fs";
import os from "os";
import path from "path";
import {
  HookFreeWrite,
  HookFreeWriteAction,
  HookFreeWriteForm,
  HookFreeWriteScanner,
} from "./HookFreeWriteScan";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * THE SCAN BEHIND HookFreeWritesAreRecorded, ON CODE MADE FOR IT: each of
 * the four kinds of write round DatabaseService's hooks is found, with the
 * model and the columns it writes, and the functions that record an audit
 * entry are told from those that do not - by a direct call, a function of
 * the same file, an imported one, and a route's nameless handler.
 */

let root: string;
let writes: Array<HookFreeWrite>;

const FILES: Record<string, string> = {
  "Common/Models/DatabaseModels/Widget.ts": `export default class Widget {}`,
  "Common/Server/Services/WidgetService.ts": `
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/Widget";
export class Service extends DatabaseService<Model> {
  public async stampOwn(id: string): Promise<void> {
    await this.updateColumnsByIdWithoutHooks({ id, data: { name: "x" } });
  }
}
export default new Service();
`,
  "Common/Server/Utils/Recorder.ts": `
import AuditLogService from "../Services/AuditLogService";
export default class Recorder {
  public static async record(): Promise<void> {
    await AuditLogService.recordUpdate({});
  }
}
`,
  "Common/Server/Utils/Writes.ts": `
import WidgetService from "../Services/WidgetService";
import Widget from "../../Models/DatabaseModels/Widget";
import AuditLogService from "../Services/AuditLogService";
import Recorder from "./Recorder";
import Router from "./Router";

// WidgetService.updateColumnsByIdWithoutHooks({ id, data: {} }) in a comment is no write.
const text: string = "updateColumnsByIdWithoutHooks( in a string is none either";

export async function plainWrite(id: string): Promise<void> {
  await WidgetService.updateColumnsByIdWithoutHooks({
    id,
    data: { name: "x", ...(id ? { description: "y" } : {}) },
  });
}

export async function builtUp(id: string): Promise<void> {
  const update: Record<string, unknown> = { name: "x" };
  update.labelsSeen = 1;
  update["color"] = "red";
  await WidgetService.compareAndSetColumnsByIdWithoutHooks({ id, data: update, expectedData: {} });
}

export async function unknownColumns(id: string, data: Record<string, unknown>): Promise<void> {
  await WidgetService.updateColumnsByIdWithoutHooks({ id, data });
}

export async function recordsItself(id: string): Promise<void> {
  await WidgetService.updateColumnsByIdWithoutHooks({ id, data: { name: "x" } });
  await AuditLogService.recordUpdate({});
}

async function helperThatRecords(): Promise<void> {
  await AuditLogService.recordCreate({});
}

export async function recordsThroughItsFile(id: string): Promise<void> {
  await WidgetService.updateColumnsByIdWithoutHooks({ id, data: { name: "x" } });
  await helperThatRecords();
}

export async function recordsThroughAnImport(id: string): Promise<void> {
  await WidgetService.updateColumnsByIdWithoutHooks({ id, data: { name: "x" } });
  await Recorder.record();
}

Router.post("/x", async (): Promise<void> => {
  await WidgetService.updateColumnsByIdWithoutHooks({ id: "1", data: { name: "x" } });
  await AuditLogService.recordUpdate({});
});

export async function relationWrite(id: string): Promise<void> {
  await WidgetService.getRepository()
    .createQueryBuilder()
    .relation(Widget, "labels")
    .of(id)
    .add(["a"]);
}

export async function createsWithoutHooks(): Promise<void> {
  await WidgetService.create({ data: {}, props: { isRoot: true, ignoreHooks: true } });
  await WidgetService.create({ data: {}, props: { isRoot: true } });
}

export async function createsThroughProps(): Promise<void> {
  const props: Record<string, boolean> = { isRoot: true, ignoreHooks: true };
  await WidgetService.create({ data: {}, props });
  const copied: Record<string, boolean> = { ...props };
  await WidgetService.createMany({ items: [], props: copied });
  const plain: Record<string, boolean> = { isRoot: true };
  await WidgetService.create({ data: {}, props: plain });
}

export async function rawSql(): Promise<void> {
  await WidgetService.executeQuery(\`UPDATE "Widget" SET "name" = $1, "color" = $2 WHERE "_id" = $3\`);
  await WidgetService.executeQuery('INSERT INTO "Widget" ("name") VALUES ($1)');
  await WidgetService.executeQuery('DELETE FROM "Widget" WHERE "_id" = $1');
}
`,
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hook-free-writes-"));

  for (const [file, text] of Object.entries(FILES)) {
    const full: string = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }

  writes = new HookFreeWriteScanner({
    repoRoot: root,
    commonRoot: path.join(root, "Common"),
    writeMethods: new Set<string>([
      "updateColumnsByIdWithoutHooks",
      "compareAndSetColumnsByIdWithoutHooks",
    ]),
  }).scan([path.join(root, "Common", "Server")]);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function inFunction(name: string): Array<HookFreeWrite> {
  return writes.filter((write: HookFreeWrite): boolean => {
    return write.inFunction === name;
  });
}

function only(name: string): HookFreeWrite {
  const found: Array<HookFreeWrite> = inFunction(name);
  expect([name, found.length]).toEqual([name, 1]);
  return found[0]!;
}

describe("the scan finds", () => {
  test("a *WithoutHooks write, with the model of the service it is made through", () => {
    const write: HookFreeWrite = only("plainWrite");

    expect(write.form).toBe(HookFreeWriteForm.WithoutHooks);
    expect(write.action).toBe(HookFreeWriteAction.Update);
    expect(write.modelFile).toBe("Widget");
    expect(write.file).toBe("Common/Server/Utils/Writes.ts");
  });

  test("the columns it writes: through spreads and conditionals, and a local built up", () => {
    expect(only("plainWrite").columns).toEqual(["description", "name"]);
    expect(only("builtUp").columns).toEqual(["color", "labelsSeen", "name"]);
  });

  test("no columns when the code does not say them", () => {
    expect(only("unknownColumns").columns).toBeNull();
  });

  test("a service's own write, through this", () => {
    const write: HookFreeWrite = only("Service.stampOwn");

    expect(write.modelFile).toBe("Widget");
    expect(write.columns).toEqual(["name"]);
  });

  test("a relation write, with its entity and column", () => {
    const write: HookFreeWrite = only("relationWrite");

    expect(write.form).toBe(HookFreeWriteForm.Relation);
    expect(write.modelFile).toBe("Widget");
    expect(write.columns).toEqual(["labels"]);
  });

  test("a create with ignoreHooks, and not one without", () => {
    const write: HookFreeWrite = only("createsWithoutHooks");

    expect(write.form).toBe(HookFreeWriteForm.IgnoreHooksCreate);
    expect(write.action).toBe(HookFreeWriteAction.Create);
  });

  test("a create whose props say ignoreHooks through a local, its shorthand or a spread", () => {
    const creates: Array<HookFreeWrite> = inFunction("createsThroughProps");

    expect(
      creates.map((write: HookFreeWrite): string => {
        return write.call;
      }),
    ).toEqual(["create", "createMany"]);
  });

  test("raw SQL that updates, inserts and deletes, with the columns an UPDATE sets", () => {
    const sql: Array<HookFreeWrite> = inFunction("rawSql");

    expect(
      sql.map((write: HookFreeWrite): [string, string | null] => {
        return [write.call, write.tableName];
      }),
    ).toEqual([
      ["UPDATE", "Widget"],
      ["INSERT INTO", "Widget"],
      ["DELETE FROM", "Widget"],
    ]);
    expect(sql[0]!.columns).toEqual(["color", "name"]);
    expect(sql[2]!.action).toBe(HookFreeWriteAction.Delete);
  });

  test("nothing in a comment or a string", () => {
    expect(
      writes.filter((write: HookFreeWrite): boolean => {
        return (
          write.inFunction === "(module)" &&
          write.form !== HookFreeWriteForm.WithoutHooks
        );
      }),
    ).toEqual([]);
    expect(
      writes.filter((write: HookFreeWrite): boolean => {
        return (
          write.line <= 9 && write.file === "Common/Server/Utils/Writes.ts"
        );
      }),
    ).toEqual([]);
  });
});

describe("whether the function a write is in records it", () => {
  test("a function that calls the recorder itself does", () => {
    expect(only("recordsItself").isRecorded).toBe(true);
  });

  test("so does one that calls a function of its file that does", () => {
    expect(only("recordsThroughItsFile").isRecorded).toBe(true);
  });

  test("and one that calls an imported function that does", () => {
    expect(only("recordsThroughAnImport").isRecorded).toBe(true);
  });

  test("and a route's nameless handler that does", () => {
    const handler: Array<HookFreeWrite> = writes.filter(
      (write: HookFreeWrite): boolean => {
        return (
          write.inFunction === "(module)" &&
          write.form === HookFreeWriteForm.WithoutHooks
        );
      },
    );

    expect(handler).toHaveLength(1);
    expect(handler[0]!.isRecorded).toBe(true);
  });

  test("a function that does not, does not", () => {
    expect(only("plainWrite").isRecorded).toBe(false);
    expect(only("relationWrite").isRecorded).toBe(false);
  });
});
