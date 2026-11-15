import { describe, expect, test } from "@jest/globals";

/*
 * A suite that forgot to stand in for a read: Tests/Helpers/
 * RealNetworkRequests.test.ts runs it in a jest of its own and expects its
 * second test to fail, naming the request, and its first to pass. Its name
 * ends in .fixture.ts, so Common's own jest run (testRegex: *.test.ts)
 * never picks it up.
 */

describe("a suite that sends a request it did not stand in for", () => {
  test("draws nothing and sends nothing", () => {
    expect(1 + 1).toBe(2);
  });

  test("reads the user without standing in for API", async () => {
    const request: XMLHttpRequest = new XMLHttpRequest();
    const failed: Promise<number> = new Promise<number>(
      (resolve: (status: number) => void): void => {
        request.addEventListener("error", (): void => {
          resolve(request.status);
        });
      },
    );

    request.open("GET", "http://localhost/api/user/me");
    request.send();

    // Refused at once, as a refused connection; the test fails after it.
    expect(await failed).toBe(0);
  });
});
