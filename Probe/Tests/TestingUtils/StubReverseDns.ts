import SubnetScanner from "../../Utils/Discovery/SubnetScanner";
import { ReverseDnsResolution } from "../../Utils/Discovery/ReverseDnsResolver";
import { beforeEach, jest } from "@jest/globals";

/*
 * Keeps a test that drives the REAL SubnetScanner.scan() off the real
 * resolver (OneUptime issue #3529).
 *
 * Since reverse DNS was added, a completed sweep ends by asking for a PTR
 * record per discovered host. Every suite here already stubs the sweep's two
 * other network seams — isHostAliveByPing and SnmpMonitor.probeSystemInfo —
 * for exactly the reasons that apply again here, and more sharply:
 *
 *   - It would be real network I/O in a unit test. The sweeps below "find"
 *     hosts on 10.0.0.0/29 and 192.0.2.0/24; asking a resolver about those is
 *     a query to whatever DNS the machine running the tests happens to have.
 *   - It would make the tests machine-dependent. A developer on a corporate
 *     network whose resolver answers for RFC1918 space would see dnsHostname
 *     appear on hosts that a CI runner reports without one.
 *   - It would be slow, and slow in the worst way: the per-address budget is
 *     two seconds, so a runner with no resolver reachable would pay it per
 *     discovered host on every sweep in the file.
 *
 * The stub resolves NOTHING, which is the correct default for a suite that is
 * not about naming: hosts come back with no `dnsHostname`, exactly as they
 * did before the feature existed, so every pre-existing assertion in these
 * files still describes what it always described. Suites that ARE about
 * naming (SubnetScannerReverseDns.test.ts) install their own spy instead.
 */

/**
 * Installs the stub RIGHT NOW, for the rest of the current test.
 *
 * Exported because a per-file `beforeEach` is not enough on its own. Two
 * suites call `jest.restoreAllMocks()` in the MIDDLE of a test — to run a
 * second sweep against freshly-configured spies — and that wipes every spy in
 * the file, this one included. The second sweep then ran against the real
 * resolver: on a machine whose DNS answers for RFC1918 space (a corporate
 * resolver with 10.in-addr.arpa delegated, or any NXDOMAIN-hijacking ISP
 * resolver) the sweep came back with `dnsHostname` set on hosts the first
 * sweep had none for, and on a machine with no reachable resolver it paid the
 * full two-second per-address budget inside a unit test.
 *
 * Neither failure is visible in the assertion that breaks, which is what makes
 * it worth its own exported function rather than an inline spy: every
 * mid-test restore in a file that stubs reverse DNS has to be followed by a
 * call to this, and ReverseDnsStubIntegrity.test.ts fails the build if one
 * is not.
 */
export function installReverseDnsStub(): void {
  jest
    .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
    .mockImplementation(async (): Promise<ReverseDnsResolution> => {
      return {
        hostnameByIpAddress: new Map<string, string>(),
        isReverseDnsAvailable: true,
        isTimeBudgetExhausted: false,
      };
    });
}

/**
 * Installs the stub before every test in the calling file.
 *
 * Root-level hooks run before the hooks of any nested describe and apply to
 * every test in the file regardless of where this is called textually, so one
 * call at module scope covers the whole suite — EXCEPT across a mid-test
 * `jest.restoreAllMocks()`, which is what `installReverseDnsStub` above is for.
 */
export function stubReverseDnsAsResolvingNothing(): void {
  beforeEach(() => {
    installReverseDnsStub();
  });
}
