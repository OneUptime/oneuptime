import { describe, expect, test } from "@jest/globals";
import ToolImportRecordIndex from "../../../../Server/Utils/ToolImport/ToolImportRecordIndex";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  getGroupSourceId,
  isGroupSourceIdOf,
} from "../../../../Types/ToolImport/ToolImportScheduleRules";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";

/*
 * What imports remembered, found by kind and the tool's id: an item's
 * record, and every schedule a schedule became. Each lookup gives the very
 * records a pass over all of them would, in the same order - however the
 * tool's ids are spelled - and stays so as records are forgotten and
 * remembered.
 */

interface Remembered {
  kind?: ToolImportResourceKind | undefined;
  sourceId?: string | undefined;
  recordId: string;
}

function remembered(
  kind: ToolImportResourceKind | undefined,
  sourceId: string | undefined,
  recordId: string,
): Remembered {
  return { kind: kind, sourceId: sourceId, recordId: recordId };
}

function recordIdsOf(records: Array<Remembered>): Array<string> {
  return records.map((record: Remembered): string => {
    return record.recordId;
  });
}

// What a pass over every record finds, as the planner and the applier used to.
function passOver(
  records: Array<Remembered>,
  kind: ToolImportResourceKind,
  isMatch: (sourceId: string) => boolean,
): Array<Remembered> {
  return records.filter((record: Remembered): boolean => {
    return (
      record.kind === kind &&
      Boolean(record.sourceId) &&
      isMatch(record.sourceId!)
    );
  });
}

describe("ToolImportRecordIndex", () => {
  test("an item's record is found by its kind and the tool's id, and nothing else", () => {
    const index: ToolImportRecordIndex<Remembered> =
      new ToolImportRecordIndex<Remembered>([
        remembered(ToolImportResourceKind.Team, "platform", "team-platform"),
        remembered(
          ToolImportResourceKind.Service,
          "platform",
          "service-platform",
        ),
        remembered(ToolImportResourceKind.Team, "platform-2", "team-other"),
        remembered(ToolImportResourceKind.Team, "platform#2", "team-hash"),
      ]);

    expect(
      recordIdsOf(index.find(ToolImportResourceKind.Team, "platform")),
    ).toEqual(["team-platform"]);
    expect(
      recordIdsOf(index.find(ToolImportResourceKind.Service, "platform")),
    ).toEqual(["service-platform"]);
    expect(index.find(ToolImportResourceKind.Monitor, "platform")).toEqual([]);
    expect(index.find(ToolImportResourceKind.Team, "plat")).toEqual([]);
  });

  test("a schedule finds every schedule it became, and no other schedule's", () => {
    const index: ToolImportRecordIndex<Remembered> =
      new ToolImportRecordIndex<Remembered>([
        remembered(ToolImportResourceKind.OnCallSchedule, "s", "s-1"),
        remembered(
          ToolImportResourceKind.OnCallSchedule,
          getGroupSourceId("s", 1),
          "s-2",
        ),
        remembered(ToolImportResourceKind.OnCallSchedule, "s2", "other"),
        remembered(
          ToolImportResourceKind.OnCallSchedule,
          getGroupSourceId("s2", 1),
          "other-2",
        ),
        remembered(
          ToolImportResourceKind.OnCallSchedule,
          getGroupSourceId("s", 2),
          "s-3",
        ),
        remembered(ToolImportResourceKind.Team, getGroupSourceId("s", 1), "x"),
        // A schedule whose id in the tool has a "#" of its own.
        remembered(ToolImportResourceKind.OnCallSchedule, "s#b", "hash"),
        remembered(
          ToolImportResourceKind.OnCallSchedule,
          getGroupSourceId("s#b", 1),
          "hash-2",
        ),
      ]);

    expect(
      recordIdsOf(
        index.findWithGroups(ToolImportResourceKind.OnCallSchedule, "s2"),
      ),
    ).toEqual(["other", "other-2"]);
    expect(
      recordIdsOf(
        index.findWithGroups(ToolImportResourceKind.OnCallSchedule, "s#b"),
      ),
    ).toEqual(["hash", "hash-2"]);
    // Only by the id itself, the first schedule.
    expect(
      recordIdsOf(index.find(ToolImportResourceKind.OnCallSchedule, "s")),
    ).toEqual(["s-1"]);
    // Every id that starts with the schedule's and a "#", as isGroupSourceIdOf says.
    expect(
      recordIdsOf(
        index.findWithGroups(ToolImportResourceKind.OnCallSchedule, "s"),
      ),
    ).toEqual(["s-1", "s-2", "s-3", "hash", "hash-2"]);
  });

  test("a record with no kind or no id of the tool is never found", () => {
    const index: ToolImportRecordIndex<Remembered> =
      new ToolImportRecordIndex<Remembered>([
        remembered(undefined, "a", "no-kind"),
        remembered(ToolImportResourceKind.Team, undefined, "no-id"),
        remembered(ToolImportResourceKind.Team, "", "empty-id"),
      ]);

    expect(index.find(ToolImportResourceKind.Team, "a")).toEqual([]);
    expect(index.find(ToolImportResourceKind.Team, "")).toEqual([]);
    expect(index.findWithGroups(ToolImportResourceKind.Team, "")).toEqual([]);
  });

  test("a record forgotten is found no more, and one remembered is found at once, after those before it", () => {
    const stale: Remembered = remembered(
      ToolImportResourceKind.Service,
      "checkout",
      "stale",
    );
    const first: Remembered = remembered(
      ToolImportResourceKind.OnCallSchedule,
      "s",
      "s-1",
    );
    const second: Remembered = remembered(
      ToolImportResourceKind.OnCallSchedule,
      "s#2",
      "s-2",
    );
    const index: ToolImportRecordIndex<Remembered> =
      new ToolImportRecordIndex<Remembered>([stale, first, second]);

    index.remove([stale]);
    expect(index.find(ToolImportResourceKind.Service, "checkout")).toEqual([]);

    const made: Remembered = remembered(
      ToolImportResourceKind.Service,
      "checkout",
      "made",
    );
    index.add(made);
    expect(index.find(ToolImportResourceKind.Service, "checkout")).toEqual([
      made,
    ]);

    // One of a schedule's records forgotten; the others kept, in order.
    index.remove([first]);
    index.add(remembered(ToolImportResourceKind.OnCallSchedule, "s", "s-new"));
    expect(
      recordIdsOf(
        index.findWithGroups(ToolImportResourceKind.OnCallSchedule, "s"),
      ),
    ).toEqual(["s-2", "s-new"]);

    // Forgetting what it never held changes nothing.
    index.remove([
      remembered(ToolImportResourceKind.Service, "checkout", "never"),
      remembered(ToolImportResourceKind.Monitor, "nowhere", "never"),
    ]);
    expect(index.find(ToolImportResourceKind.Service, "checkout")).toEqual([
      made,
    ]);
  });

  test("on ids of every shape, it finds what a pass over every record finds, in the same order, as records come and go", () => {
    const random: SeededRandom = seededRandom(6007);
    const kinds: Array<ToolImportResourceKind> = [
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.Monitor,
    ];
    // Ids of the tool, "#" in them anywhere, the empty one among them.
    const ids: Array<string> = generatedTexts(
      400,
      3301,
      ["a", "b", "#", "2", "#2"],
      5,
    );
    const kindOf: () => ToolImportResourceKind = (): ToolImportResourceKind => {
      return kinds[random(kinds.length)]!;
    };

    const records: Array<Remembered> = ids.map(
      (id: string, position: number): Remembered => {
        return remembered(kindOf(), id, `record-${position}`);
      },
    );
    records.push(remembered(undefined, "a", "no-kind"));

    const index: ToolImportRecordIndex<Remembered> =
      new ToolImportRecordIndex<Remembered>(records);

    const expectSameAsPassOver: (live: Array<Remembered>) => void = (
      live: Array<Remembered>,
    ): void => {
      const differences: Array<string> = [];

      for (const kind of kinds) {
        for (const id of new Set<string>(ids)) {
          const exact: Array<string> = recordIdsOf(
            passOver(live, kind, (sourceId: string): boolean => {
              return sourceId === id;
            }),
          );
          const groups: Array<string> = recordIdsOf(
            passOver(live, kind, (sourceId: string): boolean => {
              return isGroupSourceIdOf(sourceId, id);
            }),
          );

          if (
            JSON.stringify(recordIdsOf(index.find(kind, id))) !==
            JSON.stringify(exact)
          ) {
            differences.push(`find ${kind} "${id}"`);
          }

          if (
            JSON.stringify(recordIdsOf(index.findWithGroups(kind, id))) !==
            JSON.stringify(groups)
          ) {
            differences.push(`findWithGroups ${kind} "${id}"`);
          }
        }
      }

      expect(differences).toEqual([]);
    };

    expectSameAsPassOver(records);

    // A third forgotten, in an order of their own, and new ones remembered.
    const forgotten: Array<Remembered> = shuffled(records, random).slice(
      0,
      Math.floor(records.length / 3),
    );
    index.remove(forgotten);

    const added: Array<Remembered> = shuffled(ids, random)
      .slice(0, 100)
      .map((id: string, position: number): Remembered => {
        return remembered(kindOf(), id, `added-${position}`);
      });

    for (const record of added) {
      index.add(record);
    }

    expectSameAsPassOver([
      ...records.filter((record: Remembered): boolean => {
        return !forgotten.includes(record);
      }),
      ...added,
    ]);

    // The ids drawn hold groups of one another: the check above was not idle.
    expect(
      ids.filter((id: string): boolean => {
        return ids.some((other: string): boolean => {
          return other !== id && isGroupSourceIdOf(id, other);
        });
      }).length,
    ).toBeGreaterThan(100);
  });
});
