import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import DatabaseService from "Common/Server/Services/DatabaseService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { OwnerNotificationPage } from "../../../FeatureSet/Workers/Utils/OwnerNotificationBacklog";
import PreviousTimelineEntries, {
  PREVIOUS_ENTRIES_READ_AT_MOST,
  PreviousEntriesRead,
  TimelineOf,
  previousKey,
} from "../../../FeatureSet/Workers/Utils/PreviousTimelineEntries";

/*
 * THE ENTRY BEFORE EACH STATE CHANGE, READ ONCE FOR A PAGE (issue #8863).
 *
 * "Was Offline for 3 minutes" in a state change's email is the record's
 * latest entry that started before it. The state change jobs read it once
 * per state change; now two reads stand for every state change of a record
 * on the page. Pinned here against a timeline held in memory that answers
 * both reads as Postgres does - the read of one, sorted by start newest
 * first and then by id, and the read of the entries in between - and, above
 * all, against what a read of each state change's own answers.
 */

interface Entry {
  id: string;
  monitorId: string;
  startsAt: Date | null;
  monitorStatusId: string;
}

// How the fake reads the operators the helper builds.
interface LessThan {
  lessThan: Date;
}

interface InBetween {
  inBetween: [Date, Date];
}

let table: Array<Entry> = [];
let reads: Array<{ kind: "one" | "between"; monitorId: string }> = [];

function toModel(entry: Entry): MonitorStatusTimeline {
  const model: MonitorStatusTimeline = new MonitorStatusTimeline(
    new ObjectID(entry.id),
  );
  model.monitorId = new ObjectID(entry.monitorId);
  model.monitorStatusId = new ObjectID(entry.monitorStatusId);

  if (entry.startsAt) {
    model.startsAt = entry.startsAt;
  }

  return model;
}

// Postgres's order for the read of one: startsAt newest first, then _id.
function newestFirst(a: Entry, b: Entry): number {
  return (
    b.startsAt!.getTime() - a.startsAt!.getTime() || a.id.localeCompare(b.id)
  );
}

function ofMonitor(query: Record<string, unknown>): Array<Entry> {
  return table.filter((entry: Entry): boolean => {
    return (
      entry.monitorId === String(query["monitorId"]) && Boolean(entry.startsAt)
    );
  });
}

const service: { findOneBy: jest.Mock; findBy: jest.Mock } = {
  findOneBy: jest.fn(
    async (data: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
    }) => {
      reads.push({ kind: "one", monitorId: String(data.query["monitorId"]) });
      expect(data.sort).toEqual({ startsAt: SortOrder.Descending });

      const before: Date = (data.query["startsAt"] as LessThan).lessThan;
      const found: Entry | undefined = ofMonitor(data.query)
        .filter((entry: Entry): boolean => {
          return entry.startsAt!.getTime() < before.getTime();
        })
        .sort(newestFirst)[0];

      return found ? toModel(found) : null;
    },
  ),
  findBy: jest.fn(
    async (data: { query: Record<string, unknown>; limit: number }) => {
      reads.push({
        kind: "between",
        monitorId: String(data.query["monitorId"]),
      });

      const [from, to] = (data.query["startsAt"] as InBetween).inBetween;

      return ofMonitor(data.query)
        .filter((entry: Entry): boolean => {
          const startsAt: number = entry.startsAt!.getTime();
          return startsAt >= from.getTime() && startsAt <= to.getTime();
        })
        .sort((a: Entry, b: Entry): number => {
          return (
            a.startsAt!.getTime() - b.startsAt!.getTime() ||
            a.id.localeCompare(b.id)
          );
        })
        .slice(0, data.limit)
        .map(toModel);
    },
  ),
};

const TIMELINE: TimelineOf<MonitorStatusTimeline> = {
  service: service as unknown as DatabaseService<MonitorStatusTimeline>,
  recordIdColumn: "monitorId",
  select: { monitorStatusId: true, startsAt: true, createdAt: true },
};

const START: number = Date.UTC(2026, 10, 16, 9, 0, 0);

let counter: number = 0;

function entryId(): string {
  counter++;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function monitorId(n: number): string {
  return `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function add(data: {
  monitor: number;
  minute: number | null;
  id?: string | undefined;
}): Entry {
  const entry: Entry = {
    id: data.id || entryId(),
    monitorId: monitorId(data.monitor),
    startsAt:
      data.minute === null ? null : new Date(START + data.minute * 60 * 1000),
    monitorStatusId: `22222222-0000-4000-8000-${String(counter).padStart(12, "0")}`,
  };

  table.push(entry);
  return entry;
}

// What a read of the state change's own answers: the entry before it, by id.
async function readOfItsOwn(entry: Entry): Promise<string | null> {
  const found: MonitorStatusTimeline | null =
    await PreviousTimelineEntries.of<MonitorStatusTimeline>({
      ...TIMELINE,
      entry: toModel(entry),
      page: new OwnerNotificationPage(),
    });

  return found?.id?.toString() || null;
}

// What the page answers for each state change, by id - and the reads it made.
async function readWithThePage(
  pageEntries: Array<Entry>,
): Promise<{ answers: Array<string | null>; read: PreviousEntriesRead }> {
  const page: OwnerNotificationPage = new OwnerNotificationPage();
  const models: Array<MonitorStatusTimeline> = pageEntries.map(toModel);

  const read: PreviousEntriesRead = await PreviousTimelineEntries.readForPage({
    ...TIMELINE,
    entries: models,
    page: page,
  });

  const answers: Array<string | null> = [];

  for (const model of models) {
    const found: MonitorStatusTimeline | null =
      await PreviousTimelineEntries.of<MonitorStatusTimeline>({
        ...TIMELINE,
        entry: model,
        page: page,
      });
    answers.push(found?.id?.toString() || null);
  }

  return { answers, read };
}

beforeEach(() => {
  jest.clearAllMocks();
  table = [];
  reads = [];
  counter = 0;

  jest.spyOn(QueryHelper, "lessThan").mockImplementation((value: unknown) => {
    return { lessThan: value } as never;
  });
  jest
    .spyOn(QueryHelper, "inBetween")
    .mockImplementation((from: unknown, to: unknown) => {
      return { inBetween: [from, to] } as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("each state change's previous entry, read with its page", () => {
  test("is what a read of its own answers, for monitors interleaved on one page - entries off the page and ties included", async () => {
    // A fixed seed: the same timelines every run.
    const random: SeededRandom = seededRandom(42);

    for (let scenario: number = 0; scenario < 40; scenario++) {
      table = [];
      reads = [];

      // Four monitors, their entries a few minutes apart - some at the same minute.
      for (let index: number = 0; index < 60; index++) {
        add({
          monitor: 1 + Math.floor(random() * 4),
          minute: Math.floor(random() * 30),
        });
      }

      // A page of some of them: the rest are told already, or past the page.
      const pageEntries: Array<Entry> = table.filter((): boolean => {
        return random() < 0.4;
      });

      const expected: Array<string | null> = [];

      for (const entry of pageEntries) {
        expected.push(await readOfItsOwn(entry));
      }

      const { answers } = await readWithThePage(pageEntries);

      expect(answers).toEqual(expected);
    }
  });

  test("20 state changes of 4 monitors on a page are read in 8 queries, not 20", async () => {
    const pageEntries: Array<Entry> = [];

    for (let change: number = 0; change < 5; change++) {
      for (let monitor: number = 1; monitor <= 4; monitor++) {
        pageEntries.push(add({ monitor: monitor, minute: change }));
      }
    }

    const { answers, read } = await readWithThePage(pageEntries);

    expect(reads).toHaveLength(8);
    expect(read).toEqual({ primed: 20, reads: 8 });
    // Each answered by the page: of() read nothing more.
    expect(service.findOneBy).toHaveBeenCalledTimes(4);
    expect(service.findBy).toHaveBeenCalledTimes(4);

    // Each change's previous is the same monitor's change before it.
    for (let index: number = 4; index < 20; index++) {
      expect(answers[index]).toBe(pageEntries[index - 4]!.id);
    }

    expect(answers.slice(0, 4)).toEqual([null, null, null, null]);
  });

  test("an entry between two state changes that is not on the page counts", async () => {
    const first: Entry = add({ monitor: 1, minute: 0 });
    const toldAlready: Entry = add({ monitor: 1, minute: 2 });
    const second: Entry = add({ monitor: 1, minute: 5 });

    const { answers } = await readWithThePage([first, second]);

    expect(answers).toEqual([null, toldAlready.id]);
  });

  test("the entry before the earliest state change on the page is the earliest's previous", async () => {
    const before: Entry = add({ monitor: 1, minute: 0 });
    const first: Entry = add({ monitor: 1, minute: 3 });
    const second: Entry = add({ monitor: 1, minute: 4 });

    const { answers } = await readWithThePage([first, second]);

    expect(answers).toEqual([before.id, first.id]);
  });

  test("a monitor's first state change has none", async () => {
    const first: Entry = add({ monitor: 1, minute: 0 });
    const second: Entry = add({ monitor: 1, minute: 1 });

    const { answers } = await readWithThePage([first, second]);

    expect(answers[0]).toBeNull();
  });

  test("a state change with no start has none, and is never read for", async () => {
    const withNoStart: Entry = add({ monitor: 1, minute: null });
    const first: Entry = add({ monitor: 1, minute: 3 });
    const second: Entry = add({ monitor: 1, minute: 5 });

    const { answers } = await readWithThePage([withNoStart, first, second]);

    expect(answers).toEqual([null, null, first.id]);
    // The page's two reads, for the two that started: none for the one that did not.
    expect(reads).toHaveLength(2);
  });

  test("of several that started at one moment, the first by id - as a read sorted newest first, then by id, answers", async () => {
    const tieB: Entry = add({
      monitor: 1,
      minute: 2,
      id: "00000000-0000-4000-8000-00000000000b",
    });
    const tieA: Entry = add({
      monitor: 1,
      minute: 2,
      id: "00000000-0000-4000-8000-00000000000a",
    });
    const first: Entry = add({ monitor: 1, minute: 1 });
    const later: Entry = add({ monitor: 1, minute: 6 });

    const { answers } = await readWithThePage([first, later]);

    expect(answers[1]).toBe(tieA.id);
    expect(await readOfItsOwn(later)).toBe(tieA.id);
    expect(tieB.id > tieA.id).toBe(true);
  });

  test("two state changes that started at one moment have the same previous entry", async () => {
    const before: Entry = add({ monitor: 1, minute: 0 });
    const a: Entry = add({ monitor: 1, minute: 2 });
    const b: Entry = add({ monitor: 1, minute: 2 });

    const { answers } = await readWithThePage([a, b]);

    expect(answers).toEqual([before.id, before.id]);
  });

  test("a monitor with one state change on the page keeps its one read: the page reads nothing for it", async () => {
    const before: Entry = add({ monitor: 1, minute: 0 });
    const only: Entry = add({ monitor: 1, minute: 4 });

    const page: OwnerNotificationPage = new OwnerNotificationPage();
    const read: PreviousEntriesRead = await PreviousTimelineEntries.readForPage(
      {
        ...TIMELINE,
        entries: [toModel(only)],
        page: page,
      },
    );

    expect(read).toEqual({ primed: 0, reads: 0 });
    expect(page.has(previousKey(new ObjectID(only.id)))).toBe(false);

    const found: MonitorStatusTimeline | null =
      await PreviousTimelineEntries.of<MonitorStatusTimeline>({
        ...TIMELINE,
        entry: toModel(only),
        page: page,
      });

    expect(found?.id?.toString()).toBe(before.id);
    expect(reads).toEqual([{ kind: "one", monitorId: monitorId(1) }]);
  });

  test("a monitor whose entries in between fill one read: each of its state changes reads its own", async () => {
    const first: Entry = add({ monitor: 1, minute: 0 });

    for (
      let index: number = 0;
      index < PREVIOUS_ENTRIES_READ_AT_MOST;
      index++
    ) {
      add({ monitor: 1, minute: 1 });
    }

    const last: Entry = add({ monitor: 1, minute: 2 });
    const expected: string | null = await readOfItsOwn(last);
    reads = [];

    const { answers, read } = await readWithThePage([first, last]);

    expect(read.primed).toBe(0);
    expect(answers).toEqual([null, expected]);
    // The page's two reads, then each state change its own.
    expect(
      reads.map((each: { kind: string }): string => {
        return each.kind;
      }),
    ).toEqual(["one", "between", "one", "one"]);
  });

  test("a page that could not read them leaves each state change to read its own", async () => {
    const first: Entry = add({ monitor: 1, minute: 0 });
    const second: Entry = add({ monitor: 1, minute: 1 });
    service.findBy.mockRejectedValueOnce(new Error("statement timeout"));

    const page: OwnerNotificationPage = new OwnerNotificationPage();

    await expect(
      PreviousTimelineEntries.readForPage({
        ...TIMELINE,
        entries: [toModel(first), toModel(second)],
        page: page,
      }),
    ).rejects.toThrow("statement timeout");

    const found: MonitorStatusTimeline | null =
      await PreviousTimelineEntries.of<MonitorStatusTimeline>({
        ...TIMELINE,
        entry: toModel(second),
        page: page,
      });

    expect(found?.id?.toString()).toBe(first.id);
  });

  test("asked twice for one state change, the page reads it once", async () => {
    add({ monitor: 1, minute: 0 });
    const only: Entry = add({ monitor: 1, minute: 2 });
    const page: OwnerNotificationPage = new OwnerNotificationPage();

    for (let ask: number = 0; ask < 2; ask++) {
      await PreviousTimelineEntries.of<MonitorStatusTimeline>({
        ...TIMELINE,
        entry: toModel(only),
        page: page,
      });
    }

    expect(service.findOneBy).toHaveBeenCalledTimes(1);
  });
});
