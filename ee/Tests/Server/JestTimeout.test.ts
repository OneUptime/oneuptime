import { describe, expect, test } from "@jest/globals";

/*
 * A TEST IN THE SERVER PROJECT MAY RUN LONGER THAN JEST'S DEFAULT 5 SECONDS.
 *
 * ee/jest.config.js used to set its test timeout inside each project, where
 * Jest drops it, so every ee test ran with Jest's default of 5 seconds and
 * failed with "Exceeded timeout of 5000 ms for a test" when a busy machine
 * slowed it down (#6382). The timeout is set at the top level now, for both
 * projects, and Tests/Server/JestConfig.test.ts keeps it there. This test,
 * and its twin in Tests/UI/JestTimeout.test.ts, show that it applies to the
 * tests each project runs.
 *
 * It waits 6 real seconds, on purpose. Jest times a test by the real clock,
 * so fake timers cannot show the limit, and Jest's own account of its config
 * can be wrong: Jest 30's --showConfig lists a project's testTimeout that it
 * never applies. Only a test that outlasts the default shows the limit is in
 * effect.
 */

const JEST_DEFAULT_TEST_TIMEOUT_IN_MS: number = 5000;
const LONGER_THAN_THE_DEFAULT_IN_MS: number = 6000;

describe("the server project's test timeout", () => {
  test("a test that takes 6 seconds passes", async () => {
    // The server project's environment: Node, with no document.
    expect(
      typeof (globalThis as unknown as Record<string, unknown>)["document"],
    ).toBe("undefined");

    const startedAt: number = Date.now();

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, LONGER_THAN_THE_DEFAULT_IN_MS);
    });

    expect(Date.now() - startedAt).toBeGreaterThan(
      JEST_DEFAULT_TEST_TIMEOUT_IN_MS,
    );
  });
});
