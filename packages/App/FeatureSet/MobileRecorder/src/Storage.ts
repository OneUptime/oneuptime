import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
} from "./Contract";

const REPLAY_ID_PATTERN: RegExp = /^[0-9a-f]{32}$/u;

export interface ReplayStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;

  /*
   * Optional. When present, clearing the offline outbox also removes any
   * frame a crash left untracked by its index. AsyncStorage has it.
   */
  getAllKeys?(): Promise<ReadonlyArray<string>>;
}

export const defaultReplayStorage: ReplayStorage = AsyncStorage;

export interface ReplaySessionIdentity {
  sessionId: string;
  tabId: string;
  visitorId: string;
  sessionStartUnixMs: number;
  chunkIndex: number;
}

interface StoredSession {
  sessionId: string;
  sessionStartUnixMs: number;
  lastActivityUnixMs: number;
  nextChunkIndex: number;
}

export function generateReplayId(): string {
  const bytes: Uint8Array = new Uint8Array(16);
  const cryptoRef: Crypto | undefined = globalThis.crypto;

  if (cryptoRef && typeof cryptoRef.getRandomValues === "function") {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let index: number = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes)
    .map((byte: number): string => {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
}

function isReplayId(value: unknown): value is string {
  return typeof value === "string" && REPLAY_ID_PATTERN.test(value);
}

function parseStoredSession(value: string | null): StoredSession | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const candidate: Partial<StoredSession> = parsed as Partial<StoredSession>;
    if (
      !isReplayId(candidate.sessionId) ||
      !Number.isSafeInteger(candidate.sessionStartUnixMs) ||
      !Number.isSafeInteger(candidate.lastActivityUnixMs) ||
      !Number.isSafeInteger(candidate.nextChunkIndex) ||
      (candidate.nextChunkIndex ?? -1) < 0
    ) {
      return null;
    }

    return candidate as StoredSession;
  } catch {
    return null;
  }
}

export default class ReplaySessionStore {
  private readonly storage: ReplayStorage;
  private readonly sessionKey: string;
  private readonly visitorKey: string;
  private identity: ReplaySessionIdentity | null = null;

  public constructor(storage: ReplayStorage, namespace: string) {
    this.storage = storage;
    this.sessionKey = `@oneuptime/replay/${namespace}/session`;
    this.visitorKey = `@oneuptime/replay/${namespace}/visitor`;
  }

  public async resolve(nowUnixMs: number): Promise<ReplaySessionIdentity> {
    const stored: StoredSession | null = parseStoredSession(
      await this.safeGet(this.sessionKey),
    );
    const shouldRotate: boolean =
      !stored ||
      stored.nextChunkIndex >= MAX_SESSION_REPLAY_CHUNKS_PER_SESSION ||
      nowUnixMs - stored.lastActivityUnixMs >=
        SESSION_REPLAY_IDLE_ROLLOVER_MS ||
      nowUnixMs - stored.sessionStartUnixMs >= SESSION_REPLAY_MAX_SESSION_MS;
    let session: StoredSession;
    if (shouldRotate || !stored) {
      session = {
        sessionId: generateReplayId(),
        sessionStartUnixMs: nowUnixMs,
        lastActivityUnixMs: nowUnixMs,
        nextChunkIndex: 0,
      };
    } else {
      session = {
        sessionId: stored.sessionId,
        sessionStartUnixMs: stored.sessionStartUnixMs,
        lastActivityUnixMs: nowUnixMs,
        nextChunkIndex: stored.nextChunkIndex,
      };
    }

    let visitorId: string | null = await this.safeGet(this.visitorKey);
    if (!isReplayId(visitorId)) {
      visitorId = generateReplayId();
      await this.safeSet(this.visitorKey, visitorId);
    }

    await this.safeSet(this.sessionKey, JSON.stringify(session));
    this.identity = {
      sessionId: session.sessionId,
      tabId: generateReplayId(),
      visitorId,
      sessionStartUnixMs: session.sessionStartUnixMs,
      chunkIndex: session.nextChunkIndex,
    };
    return { ...this.identity };
  }

  public async takeChunkIndex(nowUnixMs: number): Promise<number> {
    if (!this.identity) {
      await this.resolve(nowUnixMs);
    }

    const identity: ReplaySessionIdentity = this
      .identity as ReplaySessionIdentity;
    const index: number = identity.chunkIndex;
    identity.chunkIndex += 1;
    const state: StoredSession = {
      sessionId: identity.sessionId,
      sessionStartUnixMs: identity.sessionStartUnixMs,
      lastActivityUnixMs: nowUnixMs,
      nextChunkIndex: identity.chunkIndex,
    };
    await this.safeSet(this.sessionKey, JSON.stringify(state));
    return index;
  }

  public getNextChunkIndex(): number | null {
    return this.identity?.chunkIndex ?? null;
  }

  public async rotate(nowUnixMs: number): Promise<ReplaySessionIdentity> {
    let visitorId: string | null = await this.safeGet(this.visitorKey);
    if (!isReplayId(visitorId)) {
      visitorId = generateReplayId();
      await this.safeSet(this.visitorKey, visitorId);
    }
    const session: StoredSession = {
      sessionId: generateReplayId(),
      sessionStartUnixMs: nowUnixMs,
      lastActivityUnixMs: nowUnixMs,
      nextChunkIndex: 0,
    };
    await this.safeSet(this.sessionKey, JSON.stringify(session));
    this.identity = {
      sessionId: session.sessionId,
      tabId: generateReplayId(),
      visitorId,
      sessionStartUnixMs: nowUnixMs,
      chunkIndex: 0,
    };
    return { ...this.identity };
  }

  public async clear(): Promise<void> {
    this.identity = null;
    await Promise.all([
      this.safeRemove(this.sessionKey),
      this.safeRemove(this.visitorKey),
    ]);
  }

  private async safeGet(key: string): Promise<string | null> {
    try {
      return await this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private async safeSet(key: string, value: string): Promise<void> {
    try {
      await this.storage.setItem(key, value);
    } catch {
      /* Persistence failure must not throw into a customer application. */
    }
  }

  private async safeRemove(key: string): Promise<void> {
    try {
      await this.storage.removeItem(key);
    } catch {
      /* Best-effort storage cleanup. */
    }
  }
}
