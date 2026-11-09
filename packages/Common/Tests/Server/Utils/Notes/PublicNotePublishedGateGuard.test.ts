import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  PUBLISHED_MARKDOWN,
  PublishedMarkdown,
} from "../../../../Server/Utils/File/PublishedImages";

/*
 * NOTHING UNAPPROVED LEAVES THE TEAM.
 *
 * A public note waiting for approval, or rejected, is saved but not
 * published (Types/StatusPage/PublicNoteApproval): isPublished is false. It
 * must reach nobody outside the team - no status page, no RSS or Atom feed
 * (built from the status page API), no subscriber (email, SMS, Slack,
 * Microsoft Teams, webhooks...), no owner told it was posted, no AI draft of
 * the next customer update, and none of its images.
 *
 * Each of those reads the notes itself, as OneUptime (isRoot), so the
 * permission layer filters nothing: the one thing between a held note and
 * the outside is that the read asks for published notes. This reads the
 * source of every file that hands public notes to the outside and holds
 * every read of a public note there to `isPublished: true` in its query. A
 * new read added without it fails here, with the file and the line.
 *
 * And it holds PublishedImages to showing a note's images only while it is
 * published.
 */

// packages/Common/Tests/Server/Utils/Notes -> packages
const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..", "..");

/*
 * Every file that hands public notes to someone outside the team, and how
 * many reads of public notes it has: a count that changes means a read was
 * added or removed, and is looked at.
 */
const PUBLIC_FACING_READERS: ReadonlyArray<{ file: string; reads: number }> = [
  // The status page: its overview, incidents, episodes, events, their notes' files - and so RSS and Atom.
  { file: "Common/Server/API/StatusPageAPI.ts", reads: 9 },
  // Subscriber notifications: posted and updated notes.
  {
    file: "App/FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.ts",
    reads: 2,
  },
  {
    file: "App/FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
    reads: 2,
  },
  /*
   * The episode job also reads the notes it marks Skipped (they notify
   * nobody); that read sends nothing and is the one read it may make of
   * every note.
   */
  {
    file: "App/FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
    reads: 3,
  },
  // Owners told a note was posted.
  {
    file: "App/FeatureSet/Workers/Jobs/IncidentOwners/SendNotePostedNotification.ts",
    reads: 1,
  },
  {
    file: "App/FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendNotePostedNotification.ts",
    reads: 1,
  },
  // What OneUptime AI drafts the next customer update from.
  { file: "Common/Server/Utils/AI/IncidentAIContextBuilder.ts", reads: 1 },
  {
    file: "Common/Server/Utils/AI/ScheduledMaintenanceAIContextBuilder.ts",
    reads: 1,
  },
  { file: "Common/Server/Utils/AI/Toolbox/TimelineTools.ts", reads: 1 },
];

/*
 * Reads of public notes in those files that send nothing anywhere, each
 * with why. Keep it short.
 */
const READS_THAT_SEND_NOTHING: ReadonlyArray<{
  file: string;
  marker: RegExp;
  reason: string;
}> = [
  {
    file: "App/FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
    marker: /shouldStatusPageSubscribersBeNotifiedOnNoteCreated:\s*false/,
    reason:
      "marks Skipped the notes whose subscribers are not to be told; it sends nothing",
  },
];

const PUBLIC_NOTE_SERVICE: RegExp =
  /^(IncidentPublicNoteService|IncidentEpisodePublicNoteService|ScheduledMaintenancePublicNoteService)$/;

const READ_METHODS: ReadonlyArray<string> = [
  "findBy",
  "findOneBy",
  "findAllBy",
  "findOneById",
  "countBy",
];

interface NoteRead {
  // The service and method: "IncidentPublicNoteService.findBy".
  call: string;
  line: number;
  // The call's whole text.
  text: string;
  // Whether its first argument's query names isPublished: true.
  asksForPublished: boolean;
}

// `query: { ..., isPublished: true, ... }` in the call's first argument.
function asksForPublished(
  call: ts.CallExpression,
  file: ts.SourceFile,
): boolean {
  const argument: ts.Expression | undefined = call.arguments[0];

  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return false;
  }

  const query: ts.ObjectLiteralElementLike | undefined =
    argument.properties.find((property: ts.ObjectLiteralElementLike) => {
      return (
        ts.isPropertyAssignment(property) &&
        property.name.getText(file) === "query"
      );
    });

  if (
    !query ||
    !ts.isPropertyAssignment(query) ||
    !ts.isObjectLiteralExpression(query.initializer)
  ) {
    return false;
  }

  return query.initializer.properties.some(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) &&
        property.name.getText(file) === "isPublished" &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword
      );
    },
  );
}

// The reads of public notes in a file's source.
function findNoteReads(source: string): Array<NoteRead> {
  const file: ts.SourceFile = ts.createSourceFile(
    "reader.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const reads: Array<NoteRead> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      PUBLIC_NOTE_SERVICE.test(node.expression.expression.text) &&
      READ_METHODS.includes(node.expression.name.text)
    ) {
      reads.push({
        call: `${node.expression.expression.text}.${node.expression.name.text}`,
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        text: node.getText(file),
        asksForPublished: asksForPublished(node, file),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return reads;
}

describe("the detector", () => {
  test("finds a read of each kind of public note, and whether it asks for published notes", () => {
    const reads: Array<NoteRead> = findNoteReads(`
      async function a() {
        await IncidentPublicNoteService.findBy({
          query: { incidentId: id, isPublished: true },
          props: { isRoot: true },
        });
        await ScheduledMaintenancePublicNoteService.findOneBy({
          query: { _id: id },
          props: { isRoot: true },
        });
        await IncidentEpisodePublicNoteService.findAllBy({
          query: { isPublished: false },
          props: { isRoot: true },
        });
        await IncidentInternalNoteService.findBy({ query: {}, props: {} });
        await IncidentPublicNoteService.updateOneById({ id, data: {}, props: {} });
      }
    `);

    expect(
      reads.map((read: NoteRead) => {
        return [read.call, read.asksForPublished];
      }),
    ).toEqual([
      ["IncidentPublicNoteService.findBy", true],
      ["ScheduledMaintenancePublicNoteService.findOneBy", false],
      // false is no published note.
      ["IncidentEpisodePublicNoteService.findAllBy", false],
    ]);
  });

  test("a query built elsewhere is not taken as asking: the gate is written where the read is", () => {
    const reads: Array<NoteRead> = findNoteReads(`
      const query = { isPublished: true };
      IncidentPublicNoteService.findBy({ query: query, props: {} });
      IncidentPublicNoteService.findBy(findBy);
      IncidentPublicNoteService.findBy({ query: { ...published }, props: {} });
    `);

    expect(
      reads.map((read: NoteRead) => {
        return read.asksForPublished;
      }),
    ).toEqual([false, false, false]);
  });

  test("the gate removed from a real read is caught: a mutation of the status page API fails", () => {
    const source: string = fs.readFileSync(
      path.join(PACKAGES, "Common/Server/API/StatusPageAPI.ts"),
      "utf8",
    );
    const mutated: string = source.replace(/isPublished: true,/, "");

    expect(mutated).not.toBe(source);
    expect(
      findNoteReads(mutated).filter((read: NoteRead) => {
        return !read.asksForPublished;
      }),
    ).toHaveLength(1);
  });
});

describe("every public-facing read of public notes asks for published notes only", () => {
  test.each(
    PUBLIC_FACING_READERS.map((reader: { file: string; reads: number }) => {
      return [reader.file, reader.reads];
    }),
  )("%s", (file: string, expectedReads: number) => {
    const source: string = fs.readFileSync(path.join(PACKAGES, file), "utf8");
    const reads: Array<NoteRead> = findNoteReads(source);

    // A read added or removed is looked at, here.
    expect(reads).toHaveLength(expectedReads);

    const exempt: Array<RegExp> = READS_THAT_SEND_NOTHING.filter(
      (exemption: { file: string }) => {
        return exemption.file === file;
      },
    ).map((exemption: { marker: RegExp }) => {
      return exemption.marker;
    });

    const ungated: Array<string> = reads
      .filter((read: NoteRead) => {
        return (
          !read.asksForPublished &&
          !exempt.some((marker: RegExp) => {
            return marker.test(read.text);
          })
        );
      })
      .map((read: NoteRead) => {
        return `${file}:${read.line} ${read.call} reads public notes without isPublished: true`;
      });

    expect(ungated).toEqual([]);
  });

  test("every exemption still matches a read it excuses", () => {
    for (const exemption of READS_THAT_SEND_NOTHING) {
      const reads: Array<NoteRead> = findNoteReads(
        fs.readFileSync(path.join(PACKAGES, exemption.file), "utf8"),
      );

      expect(
        reads.some((read: NoteRead) => {
          return !read.asksForPublished && exemption.marker.test(read.text);
        }),
      ).toBe(true);
    }
  });
});

describe("a note's images are public only while it is published", () => {
  test.each([
    "IncidentPublicNote",
    "IncidentEpisodePublicNote",
    "ScheduledMaintenancePublicNote",
  ])("%s shows its images only while isPublished", (tableName: string) => {
    const sources: Array<PublishedMarkdown> = PUBLISHED_MARKDOWN.filter(
      (source: PublishedMarkdown) => {
        return source.tableName === tableName;
      },
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]!.shownWhen).toContain("isPublished");
    // The edit waiting for approval is none of what it shows.
    expect(sources[0]!.markdownColumns).toEqual(["note"]);
  });
});
