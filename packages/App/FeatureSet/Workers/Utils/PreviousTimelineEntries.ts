import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import Sort from "Common/Server/Types/Database/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import {
  OWNER_NOTIFICATION_PAGE_SIZE,
  OwnerNotificationPage,
} from "./OwnerNotificationBacklog";

/*
 * THE ENTRY BEFORE EACH STATE CHANGE, READ ONCE FOR A PAGE (issue #8863).
 *
 * A state change's email says what came before it: "Was Offline for 3
 * minutes". The state change jobs read a page of state changes at a time
 * (OwnerNotificationBacklog), and read the entry before each of them on its
 * own: the record's latest entry that started before it. A monitor flapping
 * through twenty status changes on a page was twenty such reads.
 *
 * Now, for each record with two or more state changes on the page, two
 * reads stand for all of them: the entry before the earliest, and every
 * entry of the record that started between the earliest and the latest.
 * Each state change's previous entry is the latest of those that started
 * before it - read from the table, not the page, so an entry told of
 * already, or one past the page, counts as it always did. A record with one
 * state change on the page keeps its one read, and one whose entries in
 * between are more than one read holds keeps a read per state change.
 *
 * What a single read answered, this answers: the entry with the latest
 * start before the state change's, and of several that started at that
 * moment, the first by id - the read sorted by start, newest first, then by
 * id (DatabaseService breaks ties by it), and took one. A state change with
 * no start, or of no record, has no previous entry.
 */

// The most entries one record's in-between read takes; past it, each reads its own.
export const PREVIOUS_ENTRIES_READ_AT_MOST: number =
  OWNER_NOTIFICATION_PAGE_SIZE * 10;

// The entries of one timeline: where they are, and what the job reads of each.
export interface TimelineOf<TEntry extends BaseModel> {
  service: DatabaseService<TEntry>;
  // The column naming the record the entries are of: "monitorId".
  recordIdColumn: string;
  // What an entry before is read with: its state, startsAt, createdAt.
  select: Select<TEntry>;
}

export interface PreviousEntriesRead {
  // State changes whose previous entry the page holds now.
  primed: number;
  // Reads made for them.
  reads: number;
}

export default class PreviousTimelineEntries {
  /*
   * Reads the previous entry of each state change of a page that has
   * another of its record on the page, and hands it to the page
   * (OwnerNotificationPage.prime) for `of` to answer without a read.
   */
  public static async readForPage<TEntry extends BaseModel>(
    data: TimelineOf<TEntry> & {
      entries: Array<TEntry>;
      page: OwnerNotificationPage;
    },
  ): Promise<PreviousEntriesRead> {
    const read: PreviousEntriesRead = { primed: 0, reads: 0 };

    // The page's state changes with a start, by the record they are of.
    const byRecord: Map<
      string,
      { recordId: ObjectID; entries: Array<TEntry> }
    > = new Map<string, { recordId: ObjectID; entries: Array<TEntry> }>();

    for (const entry of data.entries) {
      const recordId: ObjectID | null = recordIdOf(entry, data.recordIdColumn);
      const startsAt: Date | null = startOf(entry);

      if (!recordId || !startsAt || !entry.id) {
        continue;
      }

      const key: string = recordId.toString().toLowerCase();
      const ofRecord: { recordId: ObjectID; entries: Array<TEntry> } =
        byRecord.get(key) || { recordId: recordId, entries: [] };

      ofRecord.entries.push(entry);
      byRecord.set(key, ofRecord);
    }

    for (const ofRecord of byRecord.values()) {
      // One state change keeps its one read: two would be no saving.
      if (ofRecord.entries.length < 2) {
        continue;
      }

      const starts: Array<number> = ofRecord.entries.map(
        (entry: TEntry): number => {
          return startOf(entry)!.getTime();
        },
      );
      const earliest: Date = new Date(Math.min(...starts));
      const latest: Date = new Date(Math.max(...starts));

      const before: TEntry | null = await this.readBefore({
        timeline: data,
        recordId: ofRecord.recordId,
        startsBefore: earliest,
      });

      const between: Array<TEntry> = await data.service.findBy({
        query: {
          [data.recordIdColumn]: ofRecord.recordId,
          startsAt: QueryHelper.inBetween(earliest, latest),
        } as Query<TEntry>,
        select: {
          ...data.select,
          _id: true,
          startsAt: true,
        } as Select<TEntry>,
        sort: {
          startsAt: SortOrder.Ascending,
        } as Sort<TEntry>,
        limit: PREVIOUS_ENTRIES_READ_AT_MOST,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      read.reads += 2;

      // A read full to its limit may have left entries out: each reads its own.
      if (between.length >= PREVIOUS_ENTRIES_READ_AT_MOST) {
        continue;
      }

      const candidates: Array<TEntry> = [
        ...(before ? [before] : []),
        ...between.filter((entry: TEntry): boolean => {
          return Boolean(startOf(entry));
        }),
      ];

      for (const entry of ofRecord.entries) {
        data.page.prime<TEntry | null>(
          previousKey(entry.id!),
          latestStartedBefore(candidates, startOf(entry)!),
        );
        read.primed++;
      }
    }

    return read;
  }

  /*
   * A state change's previous entry: as its page read it, or read on its
   * own. Null for one with no start, or of no record.
   */
  public static async of<TEntry extends BaseModel>(
    data: TimelineOf<TEntry> & {
      entry: TEntry;
      page: OwnerNotificationPage;
    },
  ): Promise<TEntry | null> {
    const recordId: ObjectID | null = recordIdOf(
      data.entry,
      data.recordIdColumn,
    );
    const startsAt: Date | null = startOf(data.entry);

    if (!recordId || !startsAt) {
      return null;
    }

    const read: () => Promise<TEntry | null> = (): Promise<TEntry | null> => {
      return this.readBefore({
        timeline: data,
        recordId: recordId,
        startsBefore: startsAt,
      });
    };

    // A state change with no id has no key: it is read on its own.
    if (!data.entry.id) {
      return await read();
    }

    return await data.page.once(previousKey(data.entry.id), read);
  }

  // The record's latest entry that started before `startsBefore`.
  private static async readBefore<TEntry extends BaseModel>(data: {
    timeline: TimelineOf<TEntry>;
    recordId: ObjectID;
    startsBefore: Date;
  }): Promise<TEntry | null> {
    return await data.timeline.service.findOneBy({
      query: {
        [data.timeline.recordIdColumn]: data.recordId,
        startsAt: QueryHelper.lessThan(data.startsBefore),
      } as Query<TEntry>,
      sort: {
        startsAt: SortOrder.Descending,
      } as Sort<TEntry>,
      props: {
        isRoot: true,
      },
      select: data.timeline.select,
    });
  }
}

// The key a state change's previous entry is handed to its page under.
export function previousKey(entryId: ObjectID): string {
  return `previousTimelineEntry:${entryId.toString().toLowerCase()}`;
}

/*
 * Of `candidates`, the one that started latest before `startsBefore` - of
 * several that started at that moment, the first by id - or null.
 */
function latestStartedBefore<TEntry extends BaseModel>(
  candidates: Array<TEntry>,
  startsBefore: Date,
): TEntry | null {
  let latest: TEntry | null = null;

  for (const candidate of candidates) {
    const startsAt: number = startOf(candidate)!.getTime();

    if (startsAt >= startsBefore.getTime()) {
      continue;
    }

    if (!latest) {
      latest = candidate;
      continue;
    }

    const latestStartsAt: number = startOf(latest)!.getTime();

    if (
      startsAt > latestStartsAt ||
      (startsAt === latestStartsAt && idOf(candidate) < idOf(latest))
    ) {
      latest = candidate;
    }
  }

  return latest;
}

function idOf(entry: BaseModel): string {
  return (entry.id?.toString() || "").toLowerCase();
}

function startOf(entry: BaseModel): Date | null {
  const startsAt: unknown = (entry as unknown as Record<string, unknown>)[
    "startsAt"
  ];

  if (!startsAt) {
    return null;
  }

  const date: Date =
    startsAt instanceof Date ? startsAt : new Date(startsAt as string);

  return isNaN(date.getTime()) ? null : date;
}

function recordIdOf(entry: BaseModel, recordIdColumn: string): ObjectID | null {
  const value: unknown = (entry as unknown as Record<string, unknown>)[
    recordIdColumn
  ];

  if (!value) {
    return null;
  }

  return value instanceof ObjectID ? value : new ObjectID(String(value));
}
