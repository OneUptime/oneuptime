import { isVercelLogDrainPath } from "../../../Server/Utils/StartServer";
import { describe, expect, test } from "@jest/globals";

/*
 * The Vercel log drain reads its body raw, because Vercel's signature is
 * over the bytes it sent: StartServer's body parsers leave its two paths
 * alone. Everything else under /vercel - the Vercel Marketplace provider
 * API, whose JSON bodies the parsers must read - is parsed as usual.
 */
describe("isVercelLogDrainPath", () => {
  test.each([["/vercel/v1/logs"], ["/telemetry/vercel/v1/logs"]])(
    "%s is the drain, read raw",
    (path: string) => {
      expect(isVercelLogDrainPath(path)).toBe(true);
    },
  );

  test.each([
    ["/api/marketplace/vercel/v1/installations/icfg_1"],
    ["/api/marketplace/vercel/v1/installations/icfg_1/resources"],
    ["/api/marketplace/vercel/webhook"],
    ["/vercel/v1/logs/extra"],
    ["/api/vercel/v1/logs"],
    ["/otlp/v1/logs"],
    ["/fluentd/v1/logs"],
  ])("%s is not", (path: string) => {
    expect(isVercelLogDrainPath(path)).toBe(false);
  });
});
