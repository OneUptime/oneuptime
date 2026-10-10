import path from "path";
import { describe, expect, it } from "@jest/globals";
import {
  findWriteQueryReads,
  findWriteQueryReadsInCode,
  RepositoryWriteQueryRead,
  WriteQueryScan,
} from "../TestingUtils/WriteQueryReads";

/*
 * EVERY HOOK THAT JUDGES AN UPDATE BY ITS ROWS READS THEM WITH
 * findRowsAndHoldUpdateToThem.
 *
 * A hook that reads the rows an update writes by the update's own query - a
 * findBy over `updateBy.query`, a read of `updateBy.query._id` - reads them
 * in a window of its own, before the update's permission check narrows the
 * query: rows the update writes may go unread, and rows it reads may never
 * be written, or be another caller's. DatabaseService
 * .findRowsAndHoldUpdateToThem reads the rows the update writes - the ones
 * its caller may write, or the update's own window for OneUptime and a
 * master admin - and holds the update to them, so the rows checked are the
 * rows written.
 *
 * So outside DatabaseService, an update's query is only ever:
 *
 *   - narrowed in place (`updateBy.query = narrow(updateBy.query)`);
 *   - read for the one row it names by a plain id
 *     (DatabaseService.getOneRowIdNamedBy), which the write can reach alone;
 *   - read after the write, in onUpdateSuccess and onUpdateError;
 *   - or named below with the reason it is no check of rows the update may
 *     not write. The list only ever shrinks: each entry names how many
 *     times its function reads the query, and an entry that reads it no
 *     more is taken out.
 *
 * The scan reads the syntax tree (TestingUtils/WriteQueryReads): a read
 * through another name for the update - a parameter declared as an
 * UpdateBy, a copy of one, one destructured out of what holds it - or one
 * that destructures the query out of the update counts as any other.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

// Where hooks live. A directory missing from the checkout (ee/) is skipped.
const SCANNED_DIRECTORIES: Array<string> = [
  "packages/Common/Server",
  "ee/Server",
];

const SKIPPED_DIRECTORY_NAMES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "SchemaMigrations",
  "DataMigrations",
]);

/*
 * The update path itself: it reads the rows its caller may write before the
 * hooks (keepRowsCallerMayWrite), hands them to the hooks
 * (findRowsAndHoldUpdateToThem) and writes them.
 */
const UPDATE_PATH: string =
  "packages/Common/Server/Services/DatabaseService.ts";

// What an update is: the names it goes by, and the types it is declared with.
const UPDATE_SCAN: WriteQueryScan = {
  writeNames: new Set<string>(["updateBy", "updateOneBy", "update", "write"]),
  writeTypes: new Set<string>(["UpdateBy", "UpdateOneBy"]),
  // Hooks that run once the write is done: they read what was written.
  afterTheWrite: new Set<string>(["onUpdateSuccess", "onUpdateError"]),
};

interface Allowed {
  // How many times the function reads the update's query.
  mentions: number;
  reason: string;
}

const ALLOWED: Record<string, Allowed> = {
  "packages/Common/Server/Services/NetworkSiteService.ts::updateBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the update runs; the update's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteService.ts::updateOneBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the update runs; the update's hook reads, checks and holds its row inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::updateBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the update runs; the update's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::updateOneBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the update runs; the update's hook reads, checks and holds its row inside that lock.",
  },
  "packages/Common/Server/Types/Workflow/Components/BaseModel/CustomFieldsArgument.ts::queryForRecord":
    {
      mentions: 1,
      reason:
        "A workflow step's own update, composed here: each record it read is written by its own id, with the step's conditions and the version read, so every record written is one it read.",
    },
  "packages/Common/Server/Types/Workflow/Components/BaseModel/CustomFieldsArgument.ts::updateOneMergingCustomFields":
    {
      mentions: 1,
      reason:
        "Reads, with the step's own permissions, the record the step's Update One reaches, to merge its custom fields; that record is then written by its id (queryForRecord).",
    },
  "packages/Common/Server/Types/Workflow/Components/BaseModel/CustomFieldsArgument.ts::updateManyMergingCustomFields":
    {
      mentions: 1,
      reason:
        "Reads, with the step's own permissions, the records the step's Update Many reaches in its window, to merge each one's custom fields; each is then written by its own id (queryForRecord).",
    },
  "packages/Common/Server/Services/UserService.ts::onBeforeUpdate": {
    mentions: 1,
    reason:
      "Asks whether the query names the caller's own user (OwnerOnlyColumnPermission.isQueryPinnedToCurrentUser): what the query says, not what a row holds.",
  },
  "packages/Common/Server/Services/DomainService.ts::onBeforeUpdate": {
    mentions: 1,
    reason:
      "Asks whether the update names a project when its caller has none, to refuse it: what the query says, not what a row holds. The domains are read with findRowsAndHoldUpdateToThem.",
  },
  "packages/Common/Server/Services/TeamComplianceSettingService.ts::assertMayUpdate":
    {
      mentions: 1,
      reason:
        "Runs the update's own permission check on a copy of its query, ahead of the update path; reads no row.",
    },
  "packages/Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts::toUpdateStatement":
    {
      mentions: 1,
      reason:
        "Builds the analytics update statement: the write itself, not a check of it.",
    },
};

function readsIn(code: string): Array<string> {
  return findWriteQueryReadsInCode(code, UPDATE_SCAN);
}

describe("Hooks that judge an update by its rows read them with findRowsAndHoldUpdateToThem", () => {
  const reads: Array<RepositoryWriteQueryRead> = findWriteQueryReads({
    repositoryRoot: REPOSITORY_ROOT,
    directories: SCANNED_DIRECTORIES,
    skippedDirectoryNames: SKIPPED_DIRECTORY_NAMES,
    writePath: UPDATE_PATH,
    scan: UPDATE_SCAN,
  });

  it("finds the update path's own readers, so the scan reads real code", () => {
    // The listed functions read the query; a scan that sees none of them sees nothing.
    expect(reads.length).toBeGreaterThan(0);
  });

  it("reads an update's rows by its query nowhere but in the update path and the functions listed", () => {
    const unexpected: Array<string> = reads
      .filter((read: RepositoryWriteQueryRead): boolean => {
        return !ALLOWED[read.key];
      })
      .map((read: RepositoryWriteQueryRead): string => {
        return `${read.key} (line ${read.line}): ${read.text}`;
      });

    // Read them with this.findRowsAndHoldUpdateToThem(updateBy, select) instead.
    expect(unexpected).toEqual([]);
  });

  it("reads the query in each listed function no more often than listed", () => {
    const counts: Record<string, number> = {};

    for (const read of reads) {
      counts[read.key] = (counts[read.key] || 0) + 1;
    }

    const changed: Array<string> = Object.keys(ALLOWED)
      .filter((key: string): boolean => {
        return (counts[key] || 0) !== ALLOWED[key]!.mentions;
      })
      .map((key: string): string => {
        return `${key}: listed ${ALLOWED[key]!.mentions}, found ${counts[key] || 0}`;
      });

    // A function that reads it more often reads rows a new way; one that no longer does leaves the list.
    expect(changed).toEqual([]);
  });

  it("gives every listed function a reason", () => {
    for (const [key, allowed] of Object.entries(ALLOWED)) {
      expect({ key, reason: allowed.reason.length > 20 }).toEqual({
        key,
        reason: true,
      });
    }
  });
});

describe("The update query readers the scan recognizes", () => {
  it("counts a read of the update's rows by its query, whatever the update is called on", () => {
    expect(
      readsIn(`class S {
        async onBeforeUpdate(updateBy) {
          await this.findBy({ query: updateBy.query, select: {}, limit: 1, skip: 0, props: {} });
        }
        async check(data) {
          return data.service.findBy({ query: { ...data.updateBy.query }, select: {} });
        }
        async single(updateBy) {
          return this.findOneById({ id: updateBy.query._id });
        }
      }`),
    ).toEqual(["onBeforeUpdate", "check", "single"]);
  });

  it("counts it under the other names an update goes by", () => {
    expect(
      readsIn(`class S {
        async updateOneBy(updateOneBy) {
          await this.findBy({ query: updateOneBy.query, select: {} });
        }
        async step(update) {
          return this.findBy({ query: update.query, select: {} });
        }
        async lockRows(data) {
          return this.findBy({ query: data.write.query, select: {} });
        }
      }`),
    ).toEqual(["updateOneBy", "step", "lockRows"]);
  });

  it("counts a query destructured out of the update, however it is written", () => {
    expect(
      readsIn(`class S {
        async plain(updateBy) {
          const { query } = updateBy;
          return this.findBy({ query, select: {} });
        }
        async renamed(updateBy) {
          const { query: rowsQuery, props } = updateBy;
          return this.findBy({ query: rowsQuery, select: {}, props });
        }
        async nested(data) {
          const { updateBy: { query } } = data;
          return this.findBy({ query, select: {} });
        }
        async parameter({ query, props }: UpdateBy<Model>) {
          return this.findBy({ query, select: {}, props });
        }
        async assigned(updateBy) {
          let query;
          ({ query } = updateBy);
          return this.findBy({ query, select: {} });
        }
      }`),
    ).toEqual(["plain", "renamed", "nested", "parameter", "assigned"]);
  });

  it("counts a read through another name the update is held under", () => {
    expect(
      readsIn(`class S {
        async typed(change: UpdateBy<Model>) {
          return this.findBy({ query: change.query, select: {} });
        }
        async typedVariable(data) {
          const change: UpdateBy<Model> | null = data.pending;
          return this.findBy({ query: change!.query, select: {} });
        }
        async copied(data) {
          const change = data.updateBy;
          return this.findBy({ query: change.query, select: {} });
        }
        async spread(updateBy) {
          const copy = { ...updateBy, data: {} };
          return this.findBy({ query: copy.query, select: {} });
        }
        async destructuredOut(data) {
          const { updateBy: change } = data;
          return this.findBy({ query: change.query, select: {} });
        }
        async asserted(data) {
          return this.findBy({ query: (data.updateBy as UpdateBy<Model>)["query"], select: {} });
        }
      }`),
    ).toEqual([
      "typed",
      "typedVariable",
      "copied",
      "spread",
      "destructuredOut",
      "asserted",
    ]);
  });

  it("does not count a name of the same kind that holds no update", () => {
    expect(
      readsIn(`class S {
        async other(data) {
          const change = data.createBy;
          const { query } = data.findBy;
          const copy = { ...data.updateBy, query: {} };
          return [change.query, query, copy.query];
        }
        async shadowed(updateBy, rows) {
          return rows.map((change: Row) => change.query);
        }
      }`),
    ).toEqual([]);
  });

  it("does not count a narrowing in place, a one-row id read, or a read after the write", () => {
    expect(
      readsIn(`class S {
        async onBeforeUpdate(updateBy) {
          updateBy.query = applyFilter(updateBy.query, updateBy.props);
          updateBy.query = { ...updateBy.query, _id: ids };
          const id = Service.getOneRowIdNamedBy(updateBy.query);
          return this.findRowsAndHoldUpdateToThem(updateBy, { _id: true });
        }
        async narrowedThroughAName(change: UpdateBy<Model>) {
          change.query = applyFilter(change.query, change.props);
        }
        async onUpdateSuccess(onUpdate, ids) {
          const { query } = onUpdate.updateBy;
          return this.findBy({ query: onUpdate.updateBy.query });
        }
      }`),
    ).toEqual([]);
  });
});
