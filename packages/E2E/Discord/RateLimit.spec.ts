import { APIResponse, expect, test, APIRequestContext } from "@playwright/test";

/*
 * Run with a fresh disposable Redis database and this spec alone. The configured
 * setup limit defaults to 600; no production Redis instance may be used.
 */
test("Discord setup refuses excess requests without changing provider state", async ({
  request,
}: {
  request: APIRequestContext;
}): Promise<void> => {
  const limit: number = Number(process.env["DISCORD_E2E_SETUP_LIMIT"] || "600");
  expect(Number.isSafeInteger(limit) && limit > 0).toBe(true);
  const remaining: number = 60000 - (Date.now() % 60000);
  if (remaining < 30000) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, remaining + 100);
    });
  }
  const window: number = Math.floor(Date.now() / 60000);
  const statuses: Array<number> = [];
  for (let index: number = 0; index <= limit; index += 20) {
    const batch: Array<number> = await Promise.all(
      Array.from({ length: Math.min(20, limit + 1 - index) }, async () => {
        const response: APIResponse = await request.get("/api/discord/config");
        return response.status();
      }),
    );
    statuses.push(...batch);
  }
  expect(
    Math.floor(Date.now() / 60000),
    "Repeat this test if the fixed window rolled during execution",
  ).toBe(window);
  expect(
    statuses.filter((status: number) => {
      return status === 200;
    }),
  ).toHaveLength(limit);
  expect(
    statuses.filter((status: number) => {
      return status === 429;
    }),
  ).toHaveLength(1);
});

test("Discord setup fails closed when the disposable rate counter is unavailable", async ({
  request,
}: {
  request: APIRequestContext;
}): Promise<void> => {
  test.skip(
    process.env["DISCORD_E2E_REDIS_UNAVAILABLE"] !== "true",
    "Run after stopping only the dedicated fixture Redis service",
  );
  const response: APIResponse = await request.get("/api/discord/config");
  expect(response.status()).toBe(503);
});
