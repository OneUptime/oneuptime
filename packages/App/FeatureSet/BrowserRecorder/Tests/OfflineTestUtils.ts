import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { SessionReplayChunkEnvelope } from "Common/Types/Rum/SessionReplay";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import Chunker from "../src/Chunker";

/*
 * Shared by the offline-mode suites.
 *
 * IndexedDB is fake-indexeddb, a complete in-memory implementation of the
 * spec: transactions, cursors, readwrite serialisation and all. Every test
 * gets a FRESH factory, so nothing one test persisted leaks into the next -
 * except where a test deliberately builds two stores (two tabs) or two
 * transports (a page and the page after it) against the same one.
 */

declare const require: (id: string) => unknown;

interface NodeTimers {
  setImmediate: (callback: () => void) => unknown;
}

/*
 * fake-indexeddb schedules its work on the real setImmediate, which jest's
 * fake timers do not replace. Awaiting a real setImmediate a few times lets
 * every pending IndexedDB request and transaction finish, with fake timers
 * or without.
 */
const realSetImmediate: NodeTimers["setImmediate"] = (
  require("timers") as NodeTimers
).setImmediate;

export async function settle(rounds: number = 25): Promise<void> {
  for (let round: number = 0; round < rounds; round++) {
    await new Promise<void>((resolve: () => void): void => {
      realSetImmediate(resolve);
    });
  }
}

const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
  string,
  unknown
>;

export function freshIndexedDb(): void {
  globalRecord["indexedDB"] = new IDBFactory();
}

/* A browser with no IndexedDB at all: an old private window, a policy. */
export function removeIndexedDb(): void {
  delete globalRecord["indexedDB"];
}

/*
 * navigator.onLine, which jsdom hard-codes to true. Shadowed on the
 * instance, so resetBrowserOnline() gives jsdom's own getter back.
 */
export function setBrowserOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: (): boolean => {
      return online;
    },
  });
}

export function resetBrowserOnline(): void {
  delete (window.navigator as unknown as Record<string, unknown>)["onLine"];
}

export async function databaseNames(): Promise<Array<string>> {
  const factory: IDBFactory = globalRecord["indexedDB"] as IDBFactory;
  const databases: Array<IDBDatabaseInfo> = await factory.databases();

  return databases.map((info: IDBDatabaseInfo): string => {
    return info.name || "";
  });
}

export const TEST_SESSION_ID: string = "a".repeat(32);
export const TEST_TAB_ID: string = "b".repeat(32);

export function testEnvelope(
  overrides?: Partial<SessionReplayChunkEnvelope>,
): SessionReplayChunkEnvelope {
  return {
    v: 1,
    appIdentifier: "app-1",
    sessionId: TEST_SESSION_ID,
    tabId: TEST_TAB_ID,
    chunkIndex: 0,
    sessionStartUnixMs: 1_700_000_000_000,
    clientSendUnixMs: 1_700_000_015_000,
    chunkStartOffsetMs: 0,
    chunkEndOffsetMs: 15_000,
    eventCount: 12,
    hasFullSnapshot: true,
    isFinal: false,
    recorderKind: "dom",
    schemaVersion: 1,
    rrwebVersion: "2.1.1",
    recorderVersion: "14.0.1",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentState: "NotRequired",
    triggerReason: SessionReplayTriggerReason.Sampled,
    payloadEncoding: "identity",
    payloadBytes: 0,
    url: "https://shop.example.com/checkout",
    signals: Chunker.emptySignals(),
    fidelityNotices: [],
    droppedEvents: 0,
    flushFailures: 0,
    ...overrides,
  };
}

/*
 * Split a (possibly multi-frame) chunk body back into envelopes and
 * payloads, the way the server's parser does.
 */
export function framesOfBody(
  body: Uint8Array,
): Array<{ envelope: SessionReplayChunkEnvelope; payload: string }> {
  const frames: Array<{
    envelope: SessionReplayChunkEnvelope;
    payload: string;
  }> = [];
  let offset: number = 0;

  while (offset < body.length) {
    const rest: Uint8Array = body.subarray(offset);
    const newline: number = rest.indexOf(10);

    if (newline < 0) {
      break;
    }

    const envelope: SessionReplayChunkEnvelope = JSON.parse(
      new TextDecoder().decode(rest.subarray(0, newline)),
    ) as SessionReplayChunkEnvelope;
    const start: number = newline + 1;
    const end: number = start + envelope.payloadBytes;

    frames.push({
      envelope: envelope,
      payload: new TextDecoder().decode(rest.subarray(start, end)),
    });

    offset += end;
  }

  return frames;
}
