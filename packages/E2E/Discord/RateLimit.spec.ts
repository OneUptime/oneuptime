import { APIResponse, expect, test, APIRequestContext } from "@playwright/test";

/*
 * Needs a disposable Redis database; no production Redis instance may be used.
 * The configured setup limit defaults to 600 per clock-aligned 60 s window and
 * is shared by every client of /api/discord/config, so this spec owns one whole
 * window: it starts on a fresh boundary (earlier specs' hits in the current
 * window would otherwise be counted against the budget) and does not hand the
 * worker back until that window has rolled, so the next spec is not refused.
 */
const WINDOW_MS: number = 60000;

const untilNextWindow: () => number = (): number => {
  return WINDOW_MS - (Date.now() % WINDOW_MS);
};

// Resolves just after the next window boundary, whatever the clock says now.
const waitForFreshWindow: () => Promise<void> = async (): Promise<void> => {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, untilNextWindow() + 100);
  });
};

test.afterAll(async (): Promise<void> => {
  await waitForFreshWindow();
});

test("Discord setup refuses excess requests without changing provider state", async ({
  request,
}: {
  request: APIRequestContext;
}): Promise<void> => {
  const limit: number = Number(process.env["DISCORD_E2E_SETUP_LIMIT"] || "600");
  expect(Number.isSafeInteger(limit) && limit > 0).toBe(true);
  await waitForFreshWindow();
  const window: number = Math.floor(Date.now() / WINDOW_MS);
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
    Math.floor(Date.now() / WINDOW_MS),
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
