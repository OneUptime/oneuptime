import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Dictionary from "../../../../Types/Dictionary";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { FindOperator } from "typeorm";

/*
 * GUARD: A RELATION FILTERED BY IDS NEVER TAKES THE PLACE OF ITS KEY.
 *
 * A relation filtered by a plain id (`project: "<id>"`) or by ids in
 * Includes is a filter on the relation's key (`projectId`), and
 * QueryUtil.serializeQuery writes it there. The key may already hold the
 * project the request is scoped to, or a condition a permission check put
 * on it: both have to hold. Had the relation's ids been copied over the
 * key, a request naming another project's relation would have been
 * answered from that project.
 *
 *   1. For every model, every many-to-one relation: the key ends up holding
 *      both conditions, whichever of the two the query names first.
 *   2. In the server code, the only place that writes a relation's key from
 *      the relation is QueryUtil.moveRelationFilterToKey.
 */

interface Relation {
  modelType: { new (): BaseModel };
  relation: string;
  keyColumn: string;
}

/*
 * Relations whose metadata names the relation itself as its key (the
 * `user` relation of a person's own notification methods and settings,
 * whose key is `userId`). serializeQuery has no key of its own to write
 * them to, so a filter on them never reaches another column; the
 * project's or the user's condition stays on the real key. Shrink-only:
 * a relation leaves the list when its metadata names its real key.
 */
const RELATIONS_NAMED_AS_THEIR_OWN_KEY: ReadonlyArray<string> = [
  "UserCall.user",
  "UserEmail.user",
  "UserIncomingCallNumber.user",
  "UserMicrosoftTeams.user",
  "UserNotificationRule.user",
  "UserNotificationSetting.user",
  "UserPush.user",
  "UserSMS.user",
  "UserSlack.user",
  "UserTelegram.user",
  "UserWebhook.user",
  "UserWhatsApp.user",
  "WorkspaceUserAuthToken.user",
];

// Every many-to-one relation whose key is a column of its own model.
const getRelations: () => Array<Relation> = (): Array<Relation> => {
  const relations: Array<Relation> = [];

  for (const modelType of AllModelTypes) {
    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    for (const relation of Object.keys(columns)) {
      const column: TableColumnMetadata | undefined = columns[relation];

      if (
        !column ||
        column.type !== TableColumnType.Entity ||
        !column.manyToOneRelationColumn ||
        !columns[column.manyToOneRelationColumn] ||
        column.manyToOneRelationColumn === relation
      ) {
        continue;
      }

      relations.push({
        modelType: modelType,
        relation: relation,
        keyColumn: column.manyToOneRelationColumn,
      });
    }
  }

  return relations;
};

// Every value a condition on the key binds, an AND of conditions included.
const valuesOf: (condition: unknown) => Array<string> = (
  condition: unknown,
): Array<string> => {
  if (typeof condition === "string") {
    return [condition];
  }

  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (!(operator instanceof FindOperator)) {
    return [];
  }

  if (operator.type === "and") {
    return (operator.value as unknown as Array<unknown>).flatMap(valuesOf);
  }

  if (operator.type === "equal") {
    return [String(operator.value)];
  }

  return Object.values(operator.objectLiteralParameters || {})
    .flat()
    .map(String);
};

describe("a relation filtered by ids keeps its key's own condition", () => {
  const relations: Array<Relation> = getRelations();

  test("the relations named as their own key are the known ones", () => {
    const selfKeyed: Array<string> = [];

    for (const modelType of AllModelTypes) {
      const model: BaseModel = new modelType();
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

      for (const relation of Object.keys(columns)) {
        const column: TableColumnMetadata | undefined = columns[relation];

        if (
          column &&
          column.type === TableColumnType.Entity &&
          column.manyToOneRelationColumn === relation
        ) {
          selfKeyed.push(`${modelType.name}.${relation}`);
        }
      }
    }

    // A new one must name its real key; one that does leaves the list.
    expect(selfKeyed.sort()).toEqual([...RELATIONS_NAMED_AS_THEIR_OWN_KEY]);
  });

  test("finds the relations of the models", () => {
    expect(relations.length).toBeGreaterThan(500);
    expect(
      relations.some((relation: Relation): boolean => {
        return relation.relation === "project";
      }),
    ).toBe(true);
  });

  test("the key holds both an id on the key and an id on the relation, for every relation of every model", () => {
    const replaced: Array<string> = [];

    for (const { modelType, relation, keyColumn } of relations) {
      const scopedId: string = ObjectID.generate().toString();
      const namedId: string = ObjectID.generate().toString();

      for (const query of [
        { [keyColumn]: scopedId, [relation]: namedId },
        { [relation]: namedId, [keyColumn]: scopedId },
      ]) {
        const result: Dictionary<unknown> = QueryUtil.serializeQuery(
          modelType,
          query as never,
        ) as unknown as Dictionary<unknown>;

        const values: Array<string> = valuesOf(result[keyColumn]);

        if (
          result[relation] !== undefined ||
          !values.includes(scopedId) ||
          !values.includes(namedId)
        ) {
          replaced.push(`${modelType.name}.${relation} -> ${keyColumn}`);
        }
      }
    }

    expect(replaced).toEqual([]);
  });

  test("the key holds both an id on the key and ids in Includes on the relation, for every relation of every model", () => {
    const replaced: Array<string> = [];

    for (const { modelType, relation, keyColumn } of relations) {
      const scopedId: string = ObjectID.generate().toString();
      const namedIds: Array<string> = [
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
      ];

      const result: Dictionary<unknown> = QueryUtil.serializeQuery(modelType, {
        [relation]: new Includes(namedIds),
        [keyColumn]: scopedId,
      } as never) as unknown as Dictionary<unknown>;

      const values: Array<string> = valuesOf(result[keyColumn]);

      if (
        result[relation] !== undefined ||
        !values.includes(scopedId) ||
        !namedIds.every((id: string): boolean => {
          return values.includes(id);
        })
      ) {
        replaced.push(`${modelType.name}.${relation} -> ${keyColumn}`);
      }
    }

    expect(replaced).toEqual([]);
  });
});

describe("the server writes a relation's key from the relation in one place", () => {
  const serverRoots: Array<string> = [
    path.resolve(__dirname, "../../../../Server"),
    path.resolve(__dirname, "../../../../../../ee/Server"),
  ];

  const sourceFiles: (directory: string) => Array<string> = (
    directory: string,
  ): Array<string> => {
    if (!fs.existsSync(directory)) {
      return [];
    }

    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          files.push(...sourceFiles(entryPath));
        }
      } else if (entry.name.endsWith(".ts")) {
        files.push(entryPath);
      }
    }

    return files;
  };

  /*
   * An assignment to a property named by a relation's key column. Building a
   * map of columns (DatabaseService's relational columns) is not a query,
   * and is allowed by name.
   */
  const KEY_WRITE: RegExp = /\[[^\]\n]*manyToOneRelationColumn[^\]\n]*\]\s*=[^=]/g;

  const ALLOWED_KEY_WRITES: ReadonlyArray<string> = [
    "Services/DatabaseService.ts: relationalColumns[metadata.manyToOneRelationColumn] = column;",
  ];

  test("no other code copies a relation's filter over its key", () => {
    const writes: Array<string> = [];

    for (const root of serverRoots) {
      for (const file of sourceFiles(root)) {
        const source: string = fs.readFileSync(file, "utf8");

        for (const match of source.matchAll(KEY_WRITE)) {
          const lineStart: number = source.lastIndexOf("\n", match.index) + 1;
          const lineEnd: number = source.indexOf("\n", match.index);

          writes.push(
            `${path.relative(root, file)}: ${source
              .slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
              .trim()}`,
          );
        }
      }
    }

    expect(writes.sort()).toEqual([...ALLOWED_KEY_WRITES].sort());
  });

  test("QueryUtil writes a key from its relation only through moveRelationFilterToKey", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../Server/Types/Database/QueryUtil.ts"),
      "utf8",
    );

    const helperStart: number = source.indexOf(
      "private static moveRelationFilterToKey",
    );
    const helperEnd: number = source.indexOf("@CaptureSpan()", helperStart);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);

    // Every write to a key column sits inside the helper.
    const keyWrites: Array<number> = Array.from(
      source.matchAll(/record\[keyColumn\]\s*=[^=]/g),
    ).map((match: RegExpMatchArray): number => {
      return match.index as number;
    });

    expect(keyWrites.length).toBeGreaterThan(0);

    for (const index of keyWrites) {
      expect(index).toBeGreaterThan(helperStart);
      expect(index).toBeLessThan(helperEnd);
    }

    // Both kinds of relation filter go through it.
    expect(
      source.match(/QueryUtil\.moveRelationFilterToKey\(/g)?.length,
    ).toBe(2);
  });
});
