import { APIResponse, expect, test, APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { sign } from "node:crypto";
import identities from "./Fixture/identities.json";

function signed(body: string, timestamp: string): Record<string, string> {
  const path: string | undefined = process.env["DISCORD_FIXTURE_SIGNING_KEY"];
  if (!path) {
    throw new Error("Disposable DISCORD_FIXTURE_SIGNING_KEY is required");
  }
  return {
    "content-type": "application/json",
    "x-signature-timestamp": timestamp,
    "x-signature-ed25519": sign(
      null,
      Buffer.from(timestamp + body),
      readFileSync(path),
    ).toString("hex"),
  };
}

const ping: string = JSON.stringify({
  type: 1,
  application_id: identities.applicationId,
});

test("signed raw-body PING receives a Discord PONG", async ({
  request,
}: {
  request: APIRequestContext;
}): Promise<void> => {
  const timestamp: string = Math.floor(Date.now() / 1000).toString();
  const response: APIResponse = await request.post(
    "/api/discord/interactions",
    {
      data: ping,
      headers: signed(ping, timestamp),
    },
  );
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ type: 1 });
});

test("raw-byte tampering, unsigned requests and expired signatures are refused", async ({
  request,
}: {
  request: APIRequestContext;
}): Promise<void> => {
  const timestamp: string = Math.floor(Date.now() / 1000).toString();
  const expired: string = (Math.floor(Date.now() / 1000) - 3600).toString();
  for (const input of [
    { data: `${ping} `, headers: signed(ping, timestamp) },
    { data: ping, headers: { "content-type": "application/json" } },
    { data: ping, headers: signed(ping, expired) },
    {
      data: ping,
      headers: {
        ...signed(ping, timestamp),
        "x-signature-ed25519": "00".repeat(64),
      },
    },
  ]) {
    const response: APIResponse = await request.post(
      "/api/discord/interactions",
      input,
    );
    expect(
      [400, 401, 403].includes(response.status()),
      "Missing routes and server errors are not signature refusals",
    ).toBe(true);
  }
});
