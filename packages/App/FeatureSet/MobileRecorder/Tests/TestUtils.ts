import {
  MOBILE_RECORDER_KIND,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
  SessionReplayMaskingMode,
  SessionReplayTriggerReason,
} from "../src/Contract";
import { MobileReplayStartOptions, ReplayFetchResponse } from "../src/Config";
import {
  NativeAppMetadata,
  NativeViewTreeAdapter,
  NativeViewTreeNode,
} from "../src/NativeViewTree";
import { ReplayStorage } from "../src/Storage";

export class MemoryStorage implements ReplayStorage {
  public readonly values: Map<string, string> = new Map<string, string>();

  public async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export class FakeNativeViewTree implements NativeViewTreeAdapter {
  public captures: number = 0;
  public available: boolean = true;
  public tree: NativeViewTreeNode = {
    nativeId: 1,
    kind: "view",
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    backgroundColor: "#ffffff",
    children: [
      {
        nativeId: 2,
        kind: "text",
        x: 16,
        y: 24,
        width: 120,
        height: 24,
        children: [],
      },
    ],
  };

  public isAvailable(): boolean {
    return this.available;
  }

  public async captureViewTree(): Promise<NativeViewTreeNode> {
    this.captures += 1;
    return this.tree;
  }

  public async getAppMetadata(): Promise<NativeAppMetadata> {
    return {
      appName: "Checkout",
      appVersion: "2.4.1",
      osName: "ios",
      osVersion: "18.0",
    };
  }

  public async isTouchTargetPrivate(
    _targetTag: number,
    _replayRootTag: number,
  ): Promise<boolean> {
    return false;
  }
}

export class FakeAppState {
  public currentState: string = "active";
  private listeners: Set<(state: string) => void> = new Set();

  public addEventListener(
    _type: "change",
    listener: (state: string) => void,
  ): { remove(): void } {
    this.listeners.add(listener);
    return {
      remove: (): void => {
        return void this.listeners.delete(listener);
      },
    };
  }

  public emit(state: string): void {
    this.currentState = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export function response(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): ReplayFetchResponse {
  const normalized: Record<string, string> = Object.fromEntries(
    Object.entries(headers).map(([key, value]: [string, string]) => {
      return [key.toLowerCase(), value];
    }),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string): string | null {
        return normalized[name.toLowerCase()] ?? null;
      },
    },
    async json(): Promise<unknown> {
      return body;
    },
  };
}

export function enabledConfig(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    enabled: true,
    recorderVersion: "13.0.4",
    maskingMode: "MaskSensitiveInputsOnly",
    captureTrigger: "Always",
    consentMode: "NotRequired",
    samplePercentage: 100,
    maskSelectors: [],
    blockSelectors: [],
    urlAllowlist: [],
    recordCanvas: false,
    captureUserIdentity: false,
    ignoreErrorPatterns: [],
    respectDoNotTrack: true,
    configEpoch: 7,
    directive: "continue",
    ...overrides,
  };
}

export function startOptions(
  overrides: Partial<MobileReplayStartOptions> = {},
): MobileReplayStartOptions {
  return {
    host: "https://oneuptime.example",
    token: "token",
    appIdentifier: "rum-app",
    mobileAppIdentifier: "com.example.checkout",
    ...overrides,
  };
}

export function envelope(
  overrides: Partial<SessionReplayChunkEnvelope> = {},
): SessionReplayChunkEnvelope {
  return {
    v: SESSION_REPLAY_WIRE_VERSION,
    appIdentifier: "rum-app",
    sessionId: "a".repeat(32),
    tabId: "b".repeat(32),
    chunkIndex: 0,
    sessionStartUnixMs: 1_000,
    clientSendUnixMs: 2_000,
    chunkStartOffsetMs: 0,
    chunkEndOffsetMs: 1_000,
    eventCount: 1,
    hasFullSnapshot: true,
    isFinal: false,
    recorderKind: MOBILE_RECORDER_KIND,
    schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
    rrwebVersion: "synthetic-1",
    recorderVersion: "13.0.4",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentState: "NotRequired",
    triggerReason: SessionReplayTriggerReason.Sampled,
    payloadEncoding: "gzip",
    payloadBytes: 0,
    url: "app://com.example.checkout/",
    routes: ["app://com.example.checkout/"],
    signals: {
      errorCount: 0,
      rageClickCount: 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      routeCount: 0,
      clickCount: 0,
      customEventCount: 0,
    },
    fidelityNotices: [],
    droppedEvents: 0,
    flushFailures: 0,
    ...overrides,
  };
}

export async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}
