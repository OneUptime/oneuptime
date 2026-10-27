import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A RECORD TAKES ITS OWNERS FROM IS READ IN ONE PLACE.
 *
 * The Owned scope reaches a record through the record it is owned through:
 * a parent its @OwnedThrough names, or - for an owner row - the resource it
 * names (OwnedScopePermission.getOwnedThrough, read off OwnerTableRegistry).
 * Code that decides what the scope reaches must ask getOwnedThrough: one
 * that read a model's decorator alone would take an owner row for a record
 * of no owner, and let a member whose permission to add or remove owners is
 * scoped to Owned add and remove them on resources they do not own.
 *
 * So this sweeps the server code for reads of the decorator itself. The ones
 * below read it for something else, each for the reason given, and the list
 * may only shrink: an entry nothing reads any more fails the test too.
 */

const SERVER_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../../Server",
);

// Every `.ownedThrough` read of a model's decorator.
const DECORATOR_READ: RegExp = /\.ownedThrough\b/g;

/*
 * The reads that are not about what the Owned scope reaches, by file under
 * Server/, with how many each makes and why. May only shrink.
 */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  "Types/Database/Permissions/OwnedScopePermission.ts": {
    count: 2,
    reason:
      "getOwnedThrough itself reads the decorator, and hasOwners - the gate of isLimitedToOwnedRecords and of the columns kept to owners - reads it beside the owner table write it asks about separately (owners are read through their resource).",
  },
  "Types/Database/Permissions/ReadPermission.ts": {
    count: 1,
    reason:
      "The labelled records a record names (getLabelledReferences): an owner row names its resource by its relation already.",
  },
  "Types/Database/Permissions/RelationListPermission.ts": {
    count: 1,
    reason:
      "Whether a model is read record by record (isReadPerRecord): an owner row is, through its resource (@CanAccessIfCanReadOn).",
  },
  "Services/AnalyticsDatabaseService.ts": {
    count: 1,
    reason: "Analytics models, which have no owner rows.",
  },
  "Types/AnalyticsDatabase/ModelPermission.ts": {
    count: 1,
    reason: "Analytics models, which have no owner rows.",
  },
};

function serverFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }

      files.push(...serverFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }

  return files;
}

// The decorator reads of every server file that makes any, by relative path.
function decoratorReads(): Record<string, number> {
  const reads: Record<string, number> = {};

  for (const file of serverFiles(SERVER_DIRECTORY)) {
    const count: number = (
      fs.readFileSync(file, "utf8").match(DECORATOR_READ) || []
    ).length;

    if (count > 0) {
      reads[path.relative(SERVER_DIRECTORY, file).split(path.sep).join("/")] =
        count;
    }
  }

  return reads;
}

describe("what a record takes its owners from is read through OwnedScopePermission.getOwnedThrough", () => {
  test("the sweep reads the server code", () => {
    expect(serverFiles(SERVER_DIRECTORY).length).toBeGreaterThan(1000);
  });

  test("no server code reads a model's @OwnedThrough itself, but the reads listed with their reasons", () => {
    const reads: Record<string, number> = decoratorReads();

    const unexpected: Array<string> = Object.keys(reads)
      .filter((file: string): boolean => {
        return reads[file] !== ALLOWED[file]?.count;
      })
      .map((file: string): string => {
        return `${file}: ${reads[file]} read(s) of .ownedThrough - ask OwnedScopePermission.getOwnedThrough, so an owner row is owned through its resource`;
      });

    expect(unexpected).toEqual([]);
  });

  test("every allowed read is still made: the list only shrinks", () => {
    const reads: Record<string, number> = decoratorReads();

    for (const file of Object.keys(ALLOWED)) {
      expect([file, reads[file] || 0]).toEqual([file, ALLOWED[file]!.count]);
    }
  });

  test("the rule's own readers ask getOwnedThrough", () => {
    for (const [file, asks] of [
      /*
       * Among them whether the scope narrows a create (narrowsRecords) and
       * the owned records and parents beside a grant limited to labels
       * (getOwnedRecordsCondition, getOwnedParentsCondition).
       */
      ["Types/Database/Permissions/OwnedScopePermission.ts", 8],
      ["Types/Database/Permissions/BasePermission.ts", 1],
      /*
       * The create of a record under its owning parent, the update that
       * moves it to another, the check of that parent and the refusal that
       * names its kind.
       */
      ["Types/Database/Permissions/CreateScopePermission.ts", 4],
      /*
       * The parent a changed row is read with, and whether the caller owns
       * it once written, beside a permission to update limited to labels.
       */
      ["Types/Database/Permissions/UpdateScopePermission.ts", 2],
    ] as Array<[string, number]>) {
      const source: string = fs.readFileSync(
        path.join(SERVER_DIRECTORY, file),
        "utf8",
      );

      expect([
        file,
        source.split("OwnedScopePermission.getOwnedThrough(").length - 1,
      ]).toEqual([file, asks]);
    }
  });
});
