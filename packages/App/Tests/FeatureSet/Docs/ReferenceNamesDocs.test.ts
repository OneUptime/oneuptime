import Alert from "Common/Models/DatabaseModels/Alert";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageHeaderLink from "Common/Models/DatabaseModels/StatusPageHeaderLink";
import { getUniqueColumnsBy } from "Common/Types/Database/UniqueColumnBy";
import RelationIdUtil from "Common/Server/Utils/Database/RelationIdUtil";
import RelationNames, {
  RelationName,
} from "Common/Server/Utils/Database/RelationNames";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The API reference says how a request may name a record - by its ID field
 * or by the relation - and quotes the refusal for a request whose two names
 * disagree. The quote is the server's own words, read from the code that
 * says them, for a reference the example names (an alert's monitor).
 *
 * Persian keeps the API reference in step with English; every other
 * language falls back to English there.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function readApiReference(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "api-reference", "api-reference.md"),
    "utf8",
  );
}

function monitorRelation(): RelationName {
  const relation: RelationName | undefined = RelationNames.getSingleRelations(
    new Alert(),
  ).find((candidate: RelationName): boolean => {
    return candidate.relation === "monitor";
  });

  expect(relation).toBeDefined();

  return relation!;
}

describe("the API reference on a record named two ways", () => {
  test.each(["en", "fa"])(
    "%s quotes the refusal the server gives, word for word",
    (language: string) => {
      const relation: RelationName = monitorRelation();

      expect(readApiReference(language)).toContain(
        RelationIdUtil.getConflictMessage(relation.title, [
          relation.idColumn,
          relation.relation,
        ]),
      );
    },
  );

  test.each(["en", "fa"])(
    "%s names both of the example's fields as the API spells them",
    (language: string) => {
      const text: string = readApiReference(language);

      expect(text).toContain("`monitorId`");
      expect(text).toContain('`"monitor": { "_id": "…" }`');
    },
  );

  test("English says when a request is refused: two IDs, or an ID and an empty value", () => {
    const text: string = readApiReference("en");

    expect(text).toContain(
      "two different IDs, or an ID and an empty value — is refused with a `400` that names both fields",
    );
  });

  test("English says the record's rules hold whichever name a request uses", () => {
    const text: string = readApiReference("en");

    expect(text).toContain("Either name is checked the same way.");
    expect(text).toContain(
      "a status page group's parent group must be on the same status page",
    );
    expect(text).toContain("a status page takes at most three header links");
    expect(text).toContain("a group's name must be unique on its status page");
  });

  test("Persian says the same", () => {
    expect(readApiReference("fa")).toContain(
      "هر دو نام به یک شکل سنجیده می‌شوند.",
    );
  });

  test("the examples are the rules the server holds", () => {
    // At most three header links on a page.
    expect(new StatusPageHeaderLink().getTotalItemsByColumnName()).toBe(
      "statusPageId",
    );
    expect(new StatusPageHeaderLink().getTotalItemsNumber()).toBe(3);

    // A group's name is unique on its page.
    expect(getUniqueColumnsBy(new StatusPageGroup())).toEqual(
      expect.objectContaining({ name: "statusPageId" }),
    );
  });
});
