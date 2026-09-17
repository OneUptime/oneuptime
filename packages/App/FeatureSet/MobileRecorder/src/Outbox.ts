import { SessionReplayChunkEnvelope } from "./Contract";
import { byteLength } from "./Sanitize";
import { ReplayStorage } from "./Storage";

const MAX_OUTBOX_ENTRIES: number = 64;
const MAX_OUTBOX_BYTES: number = 8 * 1024 * 1024;

export interface PersistedReplayFrame {
  id: string;
  envelope: SessionReplayChunkEnvelope;
  payload: string;
  attempts: number;
  createdAtUnixMs: number;
}

export interface OutboxMutationResult {
  dropped: number;
}

function isFrame(value: unknown): value is PersistedReplayFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const frame: Partial<PersistedReplayFrame> =
    value as Partial<PersistedReplayFrame>;
  return (
    typeof frame.id === "string" &&
    typeof frame.payload === "string" &&
    typeof frame.attempts === "number" &&
    Number.isSafeInteger(frame.attempts) &&
    Boolean(frame.envelope) &&
    typeof frame.envelope === "object" &&
    typeof frame.envelope.sessionId === "string" &&
    typeof frame.envelope.tabId === "string" &&
    typeof frame.envelope.chunkIndex === "number"
  );
}

export function frameId(envelope: SessionReplayChunkEnvelope): string {
  return `${envelope.sessionId}:${envelope.tabId}:${envelope.chunkIndex}`;
}

export default class ReplayOutbox {
  private readonly storage: ReplayStorage;
  private readonly key: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(storage: ReplayStorage, namespace: string) {
    this.storage = storage;
    this.key = `@oneuptime/replay/${namespace}/outbox`;
  }

  public async list(): Promise<Array<PersistedReplayFrame>> {
    return await this.withLock(
      async (): Promise<Array<PersistedReplayFrame>> => {
        return this.readUnlocked();
      },
    );
  }

  private async readUnlocked(): Promise<Array<PersistedReplayFrame>> {
    try {
      const raw: string | null = await this.storage.getItem(this.key);
      if (!raw) {
        return [];
      }

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isFrame)) {
        await this.removeUnlocked();
        return [];
      }

      return parsed
        .slice()
        .sort(
          (left: PersistedReplayFrame, right: PersistedReplayFrame): number => {
            return left.createdAtUnixMs - right.createdAtUnixMs;
          },
        );
    } catch {
      await this.removeUnlocked();
      return [];
    }
  }

  public async enqueue(
    frame: PersistedReplayFrame,
  ): Promise<OutboxMutationResult> {
    return await this.withLock(async (): Promise<OutboxMutationResult> => {
      const frames: Array<PersistedReplayFrame> = await this.readUnlocked();
      if (
        frames.some((candidate: PersistedReplayFrame): boolean => {
          return candidate.id === frame.id;
        })
      ) {
        return { dropped: 0 };
      }

      frames.push(frame);
      let dropped: number = 0;
      while (
        frames.length > MAX_OUTBOX_ENTRIES ||
        byteLength(JSON.stringify(frames)) > MAX_OUTBOX_BYTES
      ) {
        frames.shift();
        dropped += 1;
      }

      await this.writeUnlocked(frames);
      return { dropped };
    });
  }

  public async remove(id: string): Promise<void> {
    await this.withLock(async (): Promise<void> => {
      const frames: Array<PersistedReplayFrame> = (
        await this.readUnlocked()
      ).filter((frame: PersistedReplayFrame): boolean => {
        return frame.id !== id;
      });
      await this.writeUnlocked(frames);
    });
  }

  public async incrementAttempts(id: string): Promise<number> {
    return await this.withLock(async (): Promise<number> => {
      const frames: Array<PersistedReplayFrame> = await this.readUnlocked();
      let attempts: number = 0;
      for (const frame of frames) {
        if (frame.id === id) {
          frame.attempts += 1;
          attempts = frame.attempts;
          break;
        }
      }

      await this.writeUnlocked(frames);
      return attempts;
    });
  }

  public async clear(): Promise<void> {
    await this.withLock(async (): Promise<void> => {
      return this.removeUnlocked();
    });
  }

  private async removeUnlocked(): Promise<void> {
    try {
      await this.storage.removeItem(this.key);
    } catch {
      /* Best-effort privacy cleanup. */
    }
  }

  private async writeUnlocked(
    frames: Array<PersistedReplayFrame>,
  ): Promise<void> {
    try {
      if (frames.length === 0) {
        await this.storage.removeItem(this.key);
        return;
      }

      await this.storage.setItem(this.key, JSON.stringify(frames));
    } catch {
      /* Recording must never destabilise the host app when storage is full. */
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result: Promise<T> = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      (): void => {
        return undefined;
      },
      (): void => {
        return undefined;
      },
    );
    return await result;
  }
}
