/*
 * An in-memory stand-in for the ioredis client, for the commands the mobile
 * app's SSO hand-off sends (Server/Services/MobileSsoHandOffService, #9989):
 * SET with EX and NX, and EVAL of its two scripts, each run as Redis runs
 * it - MOBILE_SSO_TAKE_ONCE_SCRIPT reads a key and deletes it in one step;
 * MOBILE_SSO_EXCHANGE_SCRIPT deletes and answers a key only when its
 * challenge, state and S256 match, and leaves it otherwise. Any other
 * script is refused, so a suite never passes against a script the stand-in
 * does not know. Both scripts were checked against a real Redis 7.2 when
 * they were written, the exchange under five concurrent redemptions of one
 * code (exactly one succeeded).
 *
 * Every key, value and TTL is kept in `entries`, so a suite can see what
 * Redis would hold - and that it holds nothing to redeem.
 */

import {
  MOBILE_SSO_EXCHANGE_SCRIPT,
  MOBILE_SSO_TAKE_ONCE_SCRIPT,
} from "../../../../Server/Services/MobileSsoHandOffService";

export interface FakeMobileSsoHandOffEntry {
  value: string;
  ttlSeconds: number;
}

export default class FakeMobileSsoHandOffRedis {
  public readonly entries: Map<string, FakeMobileSsoHandOffEntry> = new Map<
    string,
    FakeMobileSsoHandOffEntry
  >();

  // Every EVAL sent, with its arguments, in order.
  public readonly evals: Array<Array<unknown>> = [];

  public async set(
    key: string,
    value: string,
    expiryMode: string,
    ttlSeconds: number,
    condition: string,
  ): Promise<string | null> {
    if (expiryMode !== "EX" || condition !== "NX") {
      throw new Error(
        `FakeMobileSsoHandOffRedis: unexpected SET ${expiryMode} ${condition}`,
      );
    }

    if (this.entries.has(key)) {
      return null;
    }

    this.entries.set(key, { value: value, ttlSeconds: ttlSeconds });

    return "OK";
  }

  public async eval(
    script: string,
    keyCount: number,
    key: string,
    ...argv: Array<string>
  ): Promise<string | null> {
    this.evals.push([script, keyCount, key, ...argv]);

    if (keyCount !== 1) {
      throw new Error("FakeMobileSsoHandOffRedis: one key per script");
    }

    const entry: FakeMobileSsoHandOffEntry | undefined = this.entries.get(key);

    if (script === MOBILE_SSO_TAKE_ONCE_SCRIPT) {
      if (!entry) {
        return null;
      }

      this.entries.delete(key);

      return entry.value;
    }

    if (script === MOBILE_SSO_EXCHANGE_SCRIPT) {
      if (!entry) {
        return null;
      }

      let data: unknown;

      try {
        data = JSON.parse(entry.value);
      } catch {
        return null;
      }

      if (!data || typeof data !== "object") {
        return null;
      }

      const fields: Record<string, unknown> = data as Record<string, unknown>;

      if (
        fields["codeChallenge"] !== argv[0] ||
        fields["state"] !== argv[1] ||
        fields["codeChallengeMethod"] !== "S256"
      ) {
        return null;
      }

      this.entries.delete(key);

      return entry.value;
    }

    throw new Error("FakeMobileSsoHandOffRedis: a script it does not know");
  }

  // The keys it holds that start with `prefix`.
  public keysStartingWith(prefix: string): Array<string> {
    return [...this.entries.keys()].filter((key: string) => {
      return key.startsWith(prefix);
    });
  }
}
