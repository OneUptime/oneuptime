import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import { jest } from "@jest/globals";

/*
 * Redis as GlobalCache's string commands see it, in memory: getString,
 * getStrings (MGET), setString (SET ... EX), setStringIfNotExists
 * (SET ... EX NX) and deleteKeyIfValue - each key with its expiry, read
 * against Date.now(), so a test that moves the clock moves Redis with it.
 *
 * One instance is the Redis every "process" of a test shares: a test that
 * clears a process's own memory (StatusPageAPI.clearOverviewResponseCache)
 * and keeps this is another pod of the same install. `isReachable = false`
 * makes every command throw, as GlobalCache does while Redis is down.
 * `commands` keeps each command sent, by name and key.
 */
export default class FakeGlobalCacheStrings {
  public isReachable: boolean = true;

  public commands: Array<{ name: string; key: string }> = [];

  private entries: Map<string, { value: string; expiresAt: number }> = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  // Puts this in GlobalCache's place, until jest.restoreAllMocks().
  public install(): FakeGlobalCacheStrings {
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (namespace: string, key: string) => {
        return this.get(`${namespace}-${key}`, "get");
      });

    jest
      .spyOn(GlobalCache, "getStrings")
      .mockImplementation(async (namespace: string, keys: Array<string>) => {
        this.ensureReachable();

        return keys.map((key: string): string | null => {
          return this.get(`${namespace}-${key}`, "mget");
        });
      });

    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
          options?: { expiresInSeconds?: number | undefined },
        ) => {
          this.set(`${namespace}-${key}`, value, options, "set");
        },
      );

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
          options?: { expiresInSeconds?: number | undefined },
        ) => {
          const fullKey: string = `${namespace}-${key}`;

          if (this.get(fullKey, "setnx-get") !== null) {
            this.commands.push({ name: "setnx", key: fullKey });
            return false;
          }

          this.set(fullKey, value, options, "setnx");
          return true;
        },
      );

    jest
      .spyOn(GlobalCache, "deleteKeyIfValue")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          const fullKey: string = `${namespace}-${key}`;

          if (this.get(fullKey, "delifeq-get") !== value) {
            return false;
          }

          this.entries.delete(fullKey);
          this.commands.push({ name: "delifeq", key: fullKey });
          return true;
        },
      );

    return this;
  }

  /*
   * Writes a key as another process would (namespace-key), for a day unless
   * told otherwise; not counted among this process's commands.
   */
  public setRaw(fullKey: string, value: string, seconds?: number): void {
    this.entries.set(fullKey, {
      value: value,
      expiresAt: Date.now() + (seconds ?? 24 * 60 * 60) * 1000,
    });
  }

  // A key's value as Redis holds it now (namespace-key), or null.
  public peek(fullKey: string): string | null {
    const entry: { value: string; expiresAt: number } | undefined =
      this.entries.get(fullKey);

    if (!entry || Date.now() >= entry.expiresAt) {
      return null;
    }

    return entry.value;
  }

  // Every key Redis holds now, namespace and all.
  public keys(): Array<string> {
    return Array.from(this.entries.keys()).filter((key: string): boolean => {
      return this.peek(key) !== null;
    });
  }

  public clear(): void {
    this.entries.clear();
    this.commands = [];
  }

  private get(fullKey: string, name: string): string | null {
    this.ensureReachable();
    this.commands.push({ name: name, key: fullKey });

    return this.peek(fullKey);
  }

  private set(
    fullKey: string,
    value: string,
    options: { expiresInSeconds?: number | undefined } | undefined,
    name: string,
  ): void {
    this.ensureReachable();
    this.commands.push({ name: name, key: fullKey });

    const seconds: number = options?.expiresInSeconds ?? 30 * 24 * 60 * 60;

    this.entries.set(fullKey, {
      value: value,
      expiresAt: Date.now() + seconds * 1000,
    });
  }

  private ensureReachable(): void {
    if (!this.isReachable) {
      throw new Error("Cache is not connected");
    }
  }
}
