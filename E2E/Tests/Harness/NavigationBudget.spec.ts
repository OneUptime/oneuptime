import { expect, test } from "@playwright/test";

/*
 * This suite runs at workers=1 with retries=2 under a 90 minute globalTimeout,
 * so anything that can wait forever spends that budget three times over and
 * leaves the rest of the suite unrun.
 *
 * Playwright reads an unset navigationTimeout as 0 - "no limit" - and pushes
 * it onto every context made from the `browser` fixture, including the
 * browser.newPage() our beforeAll hooks call. That is not theoretical: when
 * signup stopped accepting the password registerAndCreateProject typed, the
 * waitForURL after it could not time out on its own, so it sat on each spec's
 * 300-600s beforeAll budget instead. Fifteen such hangs took 87 of the 90
 * minutes and 467 of the 618 tests never ran, which turned a handful of real
 * failures into a run that reported almost nothing.
 *
 * Nothing else in the suite fails if that option is dropped again - the cost
 * only shows up on the day something else breaks - so it is pinned here.
 */
test.describe("Playwright run budget", () => {
  test("navigations are bounded, and bounded inside the test budget", () => {
    /*
     * ?? 0 mirrors what Playwright itself does with the option unset, so an
     * option that is missing and one that is explicitly unlimited fail alike.
     */
    const navigationTimeout: number =
      test.info().project.use.navigationTimeout ?? 0;

    expect(navigationTimeout).toBeGreaterThan(0);

    /*
     * A navigation that outlives its test reports as a test or hook timeout,
     * which names the hook rather than the line that hung - the difference
     * between "beforeAll hook timeout of 300000ms exceeded" and a stack that
     * points straight at the waitForURL.
     */
    expect(navigationTimeout).toBeLessThan(test.info().project.timeout);
  });
});
