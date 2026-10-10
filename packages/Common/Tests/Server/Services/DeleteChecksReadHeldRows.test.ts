import path from "path";
import { describe, expect, it } from "@jest/globals";
import {
  findWriteQueryReads,
  findWriteQueryReadsInCode,
  RepositoryWriteQueryRead,
  WriteQueryScan,
} from "../TestingUtils/WriteQueryReads";

/*
 * EVERY HOOK THAT JUDGES A DELETE BY ITS ROWS READS THEM WITH
 * findRowsAndHoldDeleteToThem.
 *
 * A hook that reads the rows a delete removes by the delete's own query - a
 * findBy over `deleteBy.query`, a read of `deleteBy.query._id` - reads them
 * in a window of its own, before the delete's permission check narrows the
 * query: rows the delete removes may go unread, and rows it reads - and
 * acts on, posting a feed line, releasing a number, removing rows that hang
 * off them - may never be deleted, or be another caller's.
 * DatabaseService.findRowsAndHoldDeleteToThem (and findOneRowAndHoldDeleteToIt
 * for the one row a delete removes) reads the rows the delete removes - the
 * ones its caller may delete, or the delete's own window for OneUptime and a
 * master admin - and holds the delete to them, so the rows judged are the
 * rows deleted.
 *
 * So outside DatabaseService, a delete's query is only ever:
 *
 *   - narrowed in place (`deleteBy.query = narrow(deleteBy.query)`);
 *   - asked whether it names its rows by id at all (`!deleteBy.query._id`),
 *     which is what the query says, not what a row holds;
 *   - read for the one row it names by a plain id
 *     (DatabaseService.getOneRowIdNamedBy);
 *   - read after the delete, in onDeleteSuccess, onDeleteError and
 *     onHardDeleteSuccess;
 *   - or named below with the reason it is no check of rows the delete may
 *     not remove. The list only ever shrinks: each entry names how many
 *     times its function reads the query, and an entry that reads it no
 *     more is taken out.
 *
 * The scan reads the syntax tree (TestingUtils/WriteQueryReads): a read
 * through another name for the delete - a parameter declared as a DeleteBy,
 * a copy of one, one destructured out of what holds it - or one that
 * destructures the query out of the delete counts as any other.
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
 * The delete path itself: it reads the rows its caller may delete before the
 * hooks (keepRowsCallerMayWrite), hands them to the hooks
 * (findRowsAndHoldDeleteToThem) and deletes them.
 */
const DELETE_PATH: string =
  "packages/Common/Server/Services/DatabaseService.ts";

// What a delete is: the names it goes by, and the types it is declared with.
const DELETE_SCAN: WriteQueryScan = {
  writeNames: new Set<string>(["deleteBy", "deleteOneBy"]),
  writeTypes: new Set<string>(["DeleteBy", "DeleteOneBy"]),
  // Hooks that run once the delete is done: they read what was deleted.
  afterTheWrite: new Set<string>([
    "onDeleteSuccess",
    "onDeleteError",
    "onHardDeleteSuccess",
  ]),
  allowsIdPresenceTest: true,
};

interface Allowed {
  // How many times the function reads the delete's query.
  mentions: number;
  reason: string;
}

const ALLOWED: Record<string, Allowed> = {
  "packages/Common/Server/Services/NetworkSiteService.ts::deleteOneBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the delete runs; the delete's hook reads, checks and holds its row inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteService.ts::deleteBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the delete runs; the delete's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteService.ts::hardDeleteBy": {
    mentions: 2,
    reason:
      "Whether the purge is one the hierarchy lock can scope, and which projects' lock to take; the delete's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteService.ts::hardDeleteClosedLeafBatch":
    {
      mentions: 2,
      reason:
        "The retention purge's own delete, composed here: it reads the sites with no child left, and deletes exactly those by their ids, inside the hierarchy lock.",
    },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::deleteOneBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the delete runs; the delete's hook reads, checks and holds its row inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::deleteBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the delete runs; the delete's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::hardDeleteBy": {
    mentions: 2,
    reason:
      "Whether the purge is one the hierarchy lock can scope, and which projects' lock to take; the delete's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::hardDeleteClosedLeafBatch":
    {
      mentions: 2,
      reason:
        "The retention purge's own delete, composed here: it reads the types nothing uses, and deletes exactly those by their ids, inside the hierarchy lock.",
    },
  "packages/Common/Server/Services/MetricService.ts::deleteBy": {
    mentions: 2,
    reason:
      "Cascades the delete, once it is done, into the rollups by the query as the delete wrote it: what was asked and what was deleted, not a check of rows.",
  },
  "packages/Common/Server/Services/AnalyticsDatabaseService.ts::toDeleteStatement":
    {
      mentions: 1,
      reason:
        "Builds the analytics delete statement: the delete itself, not a check of it.",
    },
};

function readsIn(code: string): Array<string> {
  return findWriteQueryReadsInCode(code, DELETE_SCAN);
}

describe("Hooks that judge a delete by its rows read them with findRowsAndHoldDeleteToThem", () => {
  const reads: Array<RepositoryWriteQueryRead> = findWriteQueryReads({
    repositoryRoot: REPOSITORY_ROOT,
    directories: SCANNED_DIRECTORIES,
    skippedDirectoryNames: SKIPPED_DIRECTORY_NAMES,
    writePath: DELETE_PATH,
    scan: DELETE_SCAN,
  });

  it("finds the delete path's own readers, so the scan reads real code", () => {
    // The listed functions read the query; a scan that sees none of them sees nothing.
    expect(reads.length).toBeGreaterThan(0);
  });

  it("reads a delete's rows by its query nowhere but in the delete path and the functions listed", () => {
    const unexpected: Array<string> = reads
      .filter((read: RepositoryWriteQueryRead): boolean => {
        return !ALLOWED[read.key];
      })
      .map((read: RepositoryWriteQueryRead): string => {
        return `${read.key} (line ${read.line}): ${read.text}`;
      });

    // Read them with this.findRowsAndHoldDeleteToThem(deleteBy, select) instead.
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

describe("The delete query readers the scan recognizes", () => {
  it("counts a read of the delete's rows by its query, whatever the delete is called on", () => {
    expect(
      readsIn(`class S {
        async onBeforeDelete(deleteBy) {
          await this.findBy({ query: deleteBy.query, select: {}, limit: 1, skip: 0, props: {} });
        }
        async check(data) {
          return data.service.findBy({ query: { ...data.deleteBy.query }, select: {} });
        }
        async single(deleteBy) {
          return this.findOneById({ id: deleteBy.query._id });
        }
      }`),
    ).toEqual(["onBeforeDelete", "check", "single"]);
  });

  it("counts it under the other names a delete goes by", () => {
    expect(
      readsIn(`class S {
        async deleteOneBy(deleteOneBy) {
          await this.findBy({ query: deleteOneBy.query, select: {} });
        }
        async cleanup(onDelete) {
          return this.findBy({ query: onDelete.deleteBy.query, select: {} });
        }
      }`),
    ).toEqual(["deleteOneBy", "cleanup"]);
  });

  it("counts a query destructured out of the delete, however it is written", () => {
    expect(
      readsIn(`class S {
        async plain(deleteBy) {
          const { query } = deleteBy;
          return this.findBy({ query, select: {} });
        }
        async renamed(onDelete) {
          const { query: removed } = onDelete.deleteBy;
          return this.findBy({ query: removed, select: {} });
        }
        async parameter({ query }: DeleteBy<Model>) {
          return this.findBy({ query, select: {} });
        }
      }`),
    ).toEqual(["plain", "renamed", "parameter"]);
  });

  it("counts a read through another name the delete is held under", () => {
    expect(
      readsIn(`class S {
        async typed(removal: DeleteBy<Model>) {
          return this.findBy({ query: removal.query, select: {} });
        }
        async copied(onDelete) {
          const removal = onDelete.deleteBy;
          return this.findBy({ query: removal["query"], select: {} });
        }
        async destructuredOut(data) {
          const { deleteBy: removal } = data;
          return this.findBy({ query: removal.query, select: {} });
        }
      }`),
    ).toEqual(["typed", "copied", "destructuredOut"]);
  });

  it("counts a read of the id a query names, beyond asking whether it names one", () => {
    expect(
      readsIn(`class S {
        async onBeforeDelete(deleteBy) {
          if (deleteBy.query._id) {
            await this.archive(new ObjectID(deleteBy.query._id as string));
          }
        }
      }`),
    ).toEqual(["onBeforeDelete"]);
  });

  it("does not count a narrowing in place, an id presence test, a one-row id read, or a read after the delete", () => {
    expect(
      readsIn(`class S {
        async onBeforeDelete(deleteBy) {
          deleteBy.query = applyFilter(deleteBy.query, deleteBy.props);
          if (!deleteBy.query._id && !deleteBy.props.isRoot) {
            throw new Error("by id");
          }
          if (deleteBy.query._id) {
            return null;
          }
          const id = Service.getOneRowIdNamedBy(deleteBy.query);
          return this.findRowsAndHoldDeleteToThem(deleteBy, { _id: true });
        }
        async onDeleteSuccess(onDelete, ids) {
          return this.findBy({ query: onDelete.deleteBy.query });
        }
        async onDeleteError(error, onDelete) {
          const { query } = onDelete.deleteBy;
          return this.findBy({ query });
        }
        async onHardDeleteSuccess(onDelete, ids) {
          return this.findBy({ query: onDelete.deleteBy.query });
        }
      }`),
    ).toEqual([]);
  });
});
