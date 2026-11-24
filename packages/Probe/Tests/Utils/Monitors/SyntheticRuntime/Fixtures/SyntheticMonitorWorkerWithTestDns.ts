import dns from "dns";
import "../../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorker";

/*
 * THE PRODUCTION SYNTHETIC WORKER, WITH ONE MADE-UP NAME IN DNS.
 *
 * Some checks need a page on an origin the browser treats as a secure
 * context - origin private file system storage, for one - and on a test
 * machine the only such origins without a trusted certificate are
 * *.localhost ones. The check's egress proxy refuses loopback, so the name
 * is answered here with a public address instead, which the test's outbound
 * proxy (FakeInternet) serves from a local server: the egress guard judges
 * the address as it would any public one, and nothing else changes.
 *
 * Only this name is answered; every other lookup is the real one.
 */
export const TEST_SECURE_HOST: string = "synthetic-target.localhost";
export const TEST_SECURE_HOST_ADDRESS: string = "93.184.215.14";

const realLookup: typeof dns.promises.lookup = dns.promises.lookup.bind(
  dns.promises,
);

(dns.promises as { lookup: unknown }).lookup = async (
  hostname: string,
  options?: unknown,
): Promise<unknown> => {
  if (hostname === TEST_SECURE_HOST) {
    const answer: { address: string; family: number } = {
      address: TEST_SECURE_HOST_ADDRESS,
      family: 4,
    };
    return (options as { all?: boolean } | undefined)?.all ? [answer] : answer;
  }

  return await (realLookup as (...args: Array<unknown>) => Promise<unknown>)(
    hostname,
    options,
  );
};
