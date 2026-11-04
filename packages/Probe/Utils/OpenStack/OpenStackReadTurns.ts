import OpenStackCollectorMemory from "./OpenStackCollectorMemory";

/*
 * Reads that are a call per thing, in turns, once a cloud holds more of them than a collection
 * should ask about: a router's L3 agents, a project's quotas. Up to the limit every one is read
 * every time, as it always was. Past it each collection reads the next few, and what was not read
 * is sent as it last stood, so no series has a gap. The load stops growing with the cloud, and only
 * how fresh each one is goes on growing.
 *
 * Each record is kept as soon as it is read, so a read that fails halfway loses nothing that came
 * before it, and the next collection carries on from where this one stopped.
 */

const REMEMBERED_FOR_IN_MS: number = 24 * 60 * 60_000;

interface ReadTurnsMemory<TRecord> {
  records: Map<string, TRecord>;
  cursor: number;
}

// The next `limit` of these after the cursor, going round, and where the one after that starts.
export function takeReadTurn<T>(data: {
  items: ReadonlyArray<T>;
  limit: number;
  cursor: number;
}): { turn: Array<T>; nextCursor: number } {
  if (data.items.length <= data.limit) {
    return { turn: [...data.items], nextCursor: 0 };
  }

  const start: number = data.cursor % data.items.length;
  const turn: Array<T> = [];

  for (let offset: number = 0; offset < data.limit; offset++) {
    turn.push(data.items[(start + offset) % data.items.length] as T);
  }

  return {
    turn: turn,
    nextCursor: (start + data.limit) % data.items.length,
  };
}

export default class OpenStackReadTurns<TRecord> {
  private readonly state: ReadTurnsMemory<TRecord>;

  public constructor(data: {
    memory: OpenStackCollectorMemory;
    memoryKey: string;
    now: number;
  }) {
    this.state = data.memory.recall<ReadTurnsMemory<TRecord>>(
      data.memoryKey,
      REMEMBERED_FOR_IN_MS,
      data.now,
    ) || { records: new Map(), cursor: 0 };

    data.memory.remember(data.memoryKey, this.state, data.now);
  }

  public async read<TItem>(data: {
    items: ReadonlyArray<TItem>;
    limit: number;
    idOf: (item: TItem) => string;
    read: (item: TItem) => Promise<TRecord>;
  }): Promise<void> {
    const { turn, nextCursor }: { turn: Array<TItem>; nextCursor: number } =
      takeReadTurn({
        items: data.items,
        limit: data.limit,
        cursor: this.state.cursor,
      });

    this.state.cursor = nextCursor;

    for (const item of turn) {
      this.state.records.set(data.idOf(item), await data.read(item));
    }
  }

  // Everything known of these, read this time or not. What has gone is forgotten here.
  public getRecords<TItem>(data: {
    items: ReadonlyArray<TItem>;
    idOf: (item: TItem) => string;
  }): Array<TRecord> {
    const records: Array<TRecord> = [];
    const kept: Map<string, TRecord> = new Map();

    for (const item of data.items) {
      const id: string = data.idOf(item);
      const record: TRecord | undefined = this.state.records.get(id);

      if (record !== undefined) {
        records.push(record);
        kept.set(id, record);
      }
    }

    this.state.records = kept;

    return records;
  }
}
