import VMRunner from "../../../../Server/Utils/VM/VMRunner";
import ReturnResult from "../../../../Types/IsolatedVM/ReturnResult";
import { describe, expect, test } from "@jest/globals";

/*
 * Regression guard for the host-bridge stall.
 *
 * Every bridge the sandbox has - axios, sleep, the log sink - is an
 * isolated-vm async callback: the isolate posts a call onto Node's thread,
 * Node answers it, and the isolate resumes. Each hop only advances when the
 * event loop takes a turn, and a loop with nothing else pending sleeps until
 * its NEXT TIMER rather than turning again.
 *
 * Without a ticker to wake it, the nearest timer was usually the sandbox's own
 * 20s overall timeout, so `await sleep(0)` - and a request the SSRF guard
 * refuses synchronously, in microseconds - came back twenty seconds later as
 * "Script execution timed out". That is what failed the VMRunner SSRF suite on
 * CI while it passed on a developer's machine, where an editor or a watcher
 * happened to keep the loop busy.
 *
 * The budget below is deliberately loose. A fixed run measures single-digit
 * milliseconds per round trip; the regression measured hundreds to twenty
 * thousand. Anything between leaves this test alone.
 */

const ROUND_TRIPS: number = 12;

/*
 * Generous enough to absorb a loaded CI runner (the fixed path needs ~10ms per
 * run), tight enough that the stall - which costs at least 100ms per run, and
 * routinely a full second - cannot fit inside it.
 */
const BUDGET_MS: number = 3000;

describe("VMRunner host bridge latency", () => {
  test("a sandbox round trip does not wait for an unrelated timer", async () => {
    const started: number = Date.now();

    for (let index: number = 0; index < ROUND_TRIPS; index++) {
      const result: ReturnResult = await VMRunner.runCodeInSandbox({
        code: "await sleep(0); return 'done';",
        options: { timeout: 15000 },
      });

      /* The point is that it finished at all, quickly, and with an answer. */
      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toBe("done");
    }

    const elapsed: number = Date.now() - started;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 60000);

  test("a request the guard refuses comes back without a host round-trip stall", async () => {
    const started: number = Date.now();

    for (let index: number = 0; index < ROUND_TRIPS; index++) {
      const result: ReturnResult = await VMRunner.runCodeInSandbox({
        /*
         * Protocol-relative, so resolveEffectiveRequestUrl rejects it before
         * DNS or a socket: the only cost here is the isolate <-> host hops.
         */
        code: "try { return await axios.get('//169.254.169.254/latest/meta-data/'); } catch (error) { return 'refused'; }",
        options: { timeout: 15000 },
      });

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toBe("refused");
    }

    expect(Date.now() - started).toBeLessThan(BUDGET_MS);
  }, 60000);
});
