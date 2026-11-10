import { describe, expect, test } from "@jest/globals";

/*
 * A TEST IN THE UI PROJECT MAY RUN LONGER THAN JEST'S DEFAULT 5 SECONDS.
 *
 * ee/jest.config.js used to set its test timeout inside each project, where
 * Jest drops it, so every ee test ran with Jest's default of 5 seconds and
 * failed with "Exceeded timeout of 5000 ms for a test" when a busy machine
 * slowed it down (#6382). In this project that also beat Testing Library's
 * own wait: Common's setup file gives findBy and waitFor 5 seconds, so an
 * element that never showed up failed as a timeout instead of saying what
 * was missing. The timeout is set at the top level now, for both projects,
 * and Tests/Server/JestConfig.test.ts keeps it there. This test, and its twin
 * in Tests/Server/JestTimeout.test.ts, show that it applies to the tests each
 * project runs.
 *
 * It waits 6 real seconds, on purpose. Jest times a test by the real clock,
 * so fake timers cannot show the limit, and Jest's own account of its config
 * can be wrong: Jest 30's --showConfig lists a project's testTimeout that it
 * never applies. Only a test that outlasts the default shows the limit is in
 * effect.
 */

const JEST_DEFAULT_TEST_TIMEOUT_IN_MS: number = 5000;
const LONGER_THAN_THE_DEFAULT_IN_MS: number = 6000;

describe("the ui project's test timeout", () => {
  test("a test that takes 6 seconds passes", async () => {
    // The ui project's environment: jsdom, with a document.
    expect(typeof document).toBe("object");

    const startedAt: number = Date.now();

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, LONGER_THAN_THE_DEFAULT_IN_MS);
    });

    expect(Date.now() - startedAt).toBeGreaterThan(
      JEST_DEFAULT_TEST_TIMEOUT_IN_MS,
    );
  });
});
