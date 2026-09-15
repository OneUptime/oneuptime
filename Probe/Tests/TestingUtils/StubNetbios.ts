import SubnetScanner from "../../Utils/Discovery/SubnetScanner";
import { NetbiosNameResolution } from "../../Utils/Discovery/NetbiosNameResolver";
import { beforeEach, jest } from "@jest/globals";

/*
 * Keeps a test that reaches FetchScans.scanWithDeadline (or calls
 * SubnetScanner.attachNetbiosNames directly) off a real UDP socket
 * (OneUptime issue #3677).
 *
 * The NetBIOS lookup is off unless a scan opts in, so today most suites could
 * not reach it even unstubbed. That is exactly the kind of "cannot happen"
 * this stub exists to not depend on: the first suite that turns the flag on to
 * test something unrelated would otherwise send real datagrams to UDP 137 of
 * whatever 10.x or 192.168.x addresses its fixtures use — on a developer's
 * office network, those are somebody's machines — and would pay a real
 * listening window per sweep while doing it.
 *
 * The stub resolves NOTHING, which leaves hosts exactly as they were before
 * the feature existed: no `netbiosName` key at all, so every pre-existing
 * `toEqual` host literal still describes the same object. Suites that ARE
 * about NetBIOS naming (Jobs/Discovery/DiscoveryNetbios.test.ts) spy on
 * `resolveNetbiosNames` themselves.
 *
 * installReverseDnsStub() (StubReverseDns.ts) installs this too, so every
 * suite that already stubs reverse DNS — and every mid-test
 * `jest.restoreAllMocks()` that is followed by installReverseDnsStub() — are
 * covered without a second call. ReverseDnsStubIntegrity.test.ts enforces it.
 */

/**
 * Installs the stub RIGHT NOW, for the rest of the current test — including
 * after a mid-test `jest.restoreAllMocks()`, which wipes it.
 */
export function installNetbiosStub(): void {
  jest
    .spyOn(SubnetScanner, "resolveNetbiosNames")
    .mockImplementation(
      async (ipAddresses: Array<string>): Promise<NetbiosNameResolution> => {
        return {
          nameByIpAddress: new Map<string, string>(),
          queriedCount: 0,
          skippedCount: new Set<string>(ipAddresses).size,
          isTimeBudgetExhausted: false,
          isHostCapReached: false,
        };
      },
    );
}

/**
 * Installs the stub before every test in the calling file. One call at module
 * scope covers the whole suite, except across a mid-test restore — see
 * installNetbiosStub.
 */
export function stubNetbiosAsResolvingNothing(): void {
  beforeEach(() => {
    installNetbiosStub();
  });
}
