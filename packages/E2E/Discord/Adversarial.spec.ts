import { APIResponse, expect, test } from "@playwright/test";
import { createHash, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import identities from "./Fixture/identities.json";

interface Vector {
  name: string;
  kind: "interaction" | "oauth";
  expected: Array<number>;
  body?: string;
  signedBody?: string;
  signature?: "valid" | "changed" | "missing" | "literal";
  signatureValue?: string;
  signaturePosition?: number;
  timestampOffset?: number;
  timestampValue?: string;
  callback?: "install" | "user";
  state?: string;
}

interface ProviderEvent {
  method: string;
  path: string;
  status: number;
}

interface ProviderState {
  events: Array<ProviderEvent>;
  unhandled: Array<string>;
}

interface ObservedVector {
  name: string;
  requestDigest: string;
  expected: Array<number>;
  status?: number;
  responseDigest?: string;
  transportError?: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeVectors(seed: number): Array<Vector> {
  let state: number = seed;
  const next: () => number = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const ping: string = JSON.stringify({
    type: 1,
    application_id: identities.applicationId,
  });
  const vectors: Array<Vector> = [];
  const add: (data: Omit<Vector, "kind">) => void = (
    data: Omit<Vector, "kind">,
  ): void => {
    vectors.push({
      kind: "interaction",
      body: ping,
      signature: "valid",
      ...data,
    });
  };

  for (const [index, body] of [
    ping,
    ` \n${ping}\t`,
    JSON.stringify({ application_id: identities.applicationId, type: 1 }),
    JSON.stringify({
      type: 1,
      application_id: identities.applicationId,
      extra: "Unicode: 😀 café",
    }),
  ].entries()) {
    add({ name: `valid-ping-${index}`, body, expected: [200] });
  }

  for (let index: number = 0; index < 24; index++) {
    const original: string = JSON.stringify({
      type: 1,
      application_id: identities.applicationId,
      nonce: next().toString(16),
    });
    add({
      name: `raw-byte-tamper-${index}`,
      signedBody: original,
      body:
        index % 2 === 0 ? original + " " : original.replace("nonce", "changed"),
      expected: [401],
    });
    add({
      name: `signature-bit-change-${index}`,
      body: original,
      signature: "changed",
      signaturePosition: next() % 128,
      expected: [401],
    });
  }

  for (const [index, value] of [
    "",
    "0",
    "00",
    "a".repeat(127),
    "a".repeat(129),
    "g".repeat(128),
    "-".repeat(128),
    " ",
  ].entries()) {
    add({
      name: `malformed-signature-${index}`,
      signature: "literal",
      signatureValue: value,
      expected: [401],
    });
  }
  add({ name: "missing-signature", signature: "missing", expected: [401] });

  for (const [index, value] of [
    "",
    "0",
    "-1",
    "+1",
    "1.5",
    "NaN",
    "1e9",
    "9999999999999",
    "123x",
    " ",
  ].entries()) {
    add({
      name: `malformed-timestamp-${index}`,
      timestampValue: value,
      expected: [401],
    });
  }
  for (const offset of [-3600, -600, 600, 3600]) {
    add({
      name: `timestamp-offset-${offset}`,
      timestampOffset: offset,
      expected: [401],
    });
  }

  /*
   * Type 3 (component/button) is a supported interaction since HOM-35: it is
   * handled (200) because Discord retries non-2xx responses forever, which
   * would replay a state transition on every retry. Every other unsupported
   * type must still be a 400.
   */
  for (const type of [0, 2, 4, 5, -1, 99999, "1", null, {}]) {
    add({
      name: `unsupported-type-${JSON.stringify(type)}`,
      body: JSON.stringify({ type, application_id: identities.applicationId }),
      expected: [400],
    });
  }
  add({
    name: "unsupported-type-3",
    body: JSON.stringify({
      type: 3,
      application_id: identities.applicationId,
    }),
    expected: [200],
  });
  for (const app of [
    identities.otherGuildId,
    "",
    null,
    1000,
    {},
    [identities.applicationId],
    identities.applicationId + " ",
  ]) {
    add({
      name: `wrong-application-${JSON.stringify(app)}`,
      body: JSON.stringify({ type: 1, application_id: app }),
      expected: [400],
    });
  }
  for (const [index, body] of [
    "null",
    "[]",
    "1",
    '"ping"',
    "{}",
    '{"type":1}',
    '{"application_id":"' + identities.applicationId + '"}',
    "{",
    ping + "trailing",
  ].entries()) {
    add({ name: `malformed-body-${index}`, body, expected: [400] });
  }
  add({ name: "empty-body", body: "", expected: [400, 401] });

  const states: Array<string> = [
    "",
    "bad",
    "A".repeat(42),
    "A".repeat(44),
    "!".repeat(43),
    "../state",
    "%00",
    "null",
    "undefined",
  ];
  for (let index: number = 0; index < 6; index++) {
    // Valid syntax but never minted by the application.
    states.push(
      Array.from(
        { length: 43 },
        (): string =>
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"[
            next() % 64
          ]!,
      ).join(""),
    );
  }
  for (const callback of ["install", "user"] as const) {
    for (const [index, oauthState] of states.entries()) {
      vectors.push({
        name: `unknown-oauth-${callback}-${index}`,
        kind: "oauth",
        callback,
        state: oauthState,
        expected: [400, 401, 403],
      });
    }
  }
  return vectors;
}

async function providerState(): Promise<ProviderState> {
  const controlToken: string | undefined =
    process.env["DISCORD_FIXTURE_CONTROL_TOKEN"];
  if (!controlToken) {
    throw new Error("Disposable DISCORD_FIXTURE_CONTROL_TOKEN is required");
  }
  const response: Response = await fetch(
    "https://discord.com/__fixture/state",
    {
      headers: { "x-fixture-control": controlToken },
      signal: AbortSignal.timeout(5000),
    },
  );
  expect(
    response.status,
    "The trusted HTTPS provider fixture must be reachable",
  ).toBe(200);
  const state: ProviderState = (await response.json()) as ProviderState;
  return { events: state.events, unhandled: state.unhandled };
}

test("seeded adversarial HTTP vectors preserve Discord authentication boundaries", async ({
  request,
}, testInfo): Promise<void> => {
  test.setTimeout(120000);
  const seed: number = Number(
    process.env["DISCORD_ADVERSARIAL_SEED"] || "0x44534344",
  );
  expect(
    Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff,
    "Seed must be an unsigned 32-bit integer",
  ).toBe(true);
  const keyPath: string | undefined =
    process.env["DISCORD_FIXTURE_SIGNING_KEY"];
  if (!keyPath) {
    throw new Error("Disposable DISCORD_FIXTURE_SIGNING_KEY is required");
  }
  const privateKey: Buffer = readFileSync(keyPath);
  const vectors: Array<Vector> = makeVectors(seed);
  expect(vectors.length).toBeLessThanOrEqual(200);
  const startedAt: number = Math.floor(Date.now() / 1000);
  const before: ProviderState = await providerState();
  expect(before.unhandled).toEqual([]);
  const observed: Array<ObservedVector> = [];
  let after: ProviderState | undefined;

  try {
    for (const vector of vectors) {
      let path: string;
      const headers: Record<string, string> = {};
      if (vector.kind === "interaction") {
        path = "/api/discord/interactions";
        headers["content-type"] = "application/json";
        const timestamp: string =
          vector.timestampValue ??
          String(startedAt + (vector.timestampOffset || 0));
        headers["x-signature-timestamp"] = timestamp;
        let signature: string = sign(
          null,
          Buffer.from(timestamp + (vector.signedBody ?? vector.body ?? "")),
          privateKey,
        ).toString("hex");
        if (vector.signature === "changed") {
          const position: number = vector.signaturePosition!;
          signature =
            signature.slice(0, position) +
            (signature[position] === "0" ? "1" : "0") +
            signature.slice(position + 1);
        }
        if (vector.signature === "literal") {
          signature = vector.signatureValue!;
        }
        if (vector.signature !== "missing") {
          headers["x-signature-ed25519"] = signature;
        }
      } else {
        const query: URLSearchParams = new URLSearchParams({
          code: "unused-e2e-code",
          state: vector.state!,
        });
        path = `/api/discord/oauth/${vector.callback}?${query.toString()}`;
      }
      const result: ObservedVector = {
        name: vector.name,
        expected: vector.expected,
        requestDigest: digest(
          JSON.stringify({ path, headers, body: vector.body }),
        ),
      };
      observed.push(result);
      try {
        const response: APIResponse =
          vector.kind === "interaction"
            ? await request.post(path, {
                headers,
                data: vector.body || "",
                maxRedirects: 0,
                timeout: 5000,
              })
            : await request.get(path, { maxRedirects: 0, timeout: 5000 });
        result.status = response.status();
        const responseBody: string = await response.text();
        result.responseDigest = digest(responseBody);
        expect
          .soft(result.status, `${vector.name}: no server error`)
          .toBeLessThan(500);
        expect
          .soft(vector.expected, `${vector.name}: explicit boundary response`)
          .toContain(result.status);
        if (vector.expected.length === 1 && vector.expected[0] === 200) {
          expect
            .soft(
              responseBody,
              `${vector.name}: exact PONG or handled component ack`,
            )
            .toMatch(/^\{"type":(1|6)\}$/);
        }
      } catch (error) {
        result.transportError =
          error instanceof Error ? error.name : "UnknownError";
        expect
          .soft(
            result.transportError,
            `${vector.name}: request must reach the real app`,
          )
          .toBeUndefined();
      }
    }
    after = await providerState();
    expect(after.unhandled).toEqual([]);
    expect(
      after.events,
      "Rejected OAuth and interaction traffic must not call Discord",
    ).toEqual(before.events);
  } finally {
    await testInfo.attach("discord-adversarial-vectors", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          kind: "real-app-provider-fixture-http-e2e",
          seed,
          vectorDigest: digest(JSON.stringify(vectors)),
          startedAt,
          requestCount: observed.length,
          vectors,
          observed,
          providerBefore: before,
          providerAfter: after,
        },
        null,
        2,
      ),
    });
  }
});
