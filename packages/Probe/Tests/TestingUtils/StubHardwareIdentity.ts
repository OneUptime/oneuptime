import SnmpMonitor from "../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import SnmpHardwareIdentity from "Common/Types/Monitor/SnmpMonitor/SnmpHardwareIdentity";
import { jest } from "@jest/globals";

/*
 * Keeps a test that drives the real SubnetScanner.scan() off a real UDP socket.
 *
 * A host that answers the sweep's system group is asked a few more questions:
 * its interface table, its chassis row, its vendor's MIB. The suites that stub
 * SnmpMonitor.probeSystemInfo so that hosts "answer" do not stub those, so
 * without this each host they find would send real datagrams to 10.x and
 * 192.0.2.x addresses and wait out real timeouts.
 *
 * The stub reads NOTHING, which leaves hosts exactly as they were before the
 * read existed: none of its keys at all, so every `toEqual` host literal still
 * describes the same object. The suite about the read
 * (Utils/Discovery/SubnetScannerHardwareIdentity.test.ts) spies on it itself.
 *
 * installNetbiosStub() (StubNetbios.ts) installs this too, and every suite that
 * reaches the sweep installs that one, by itself or through
 * installReverseDnsStub(), so none needs a call of its own, and a mid-test
 * `jest.restoreAllMocks()` followed by either of them puts this back.
 * ReverseDnsStubIntegrity.test.ts enforces it.
 */

/**
 * Installs the stub RIGHT NOW, for the rest of the current test.
 */
export function installHardwareIdentityStub(): void {
  jest
    .spyOn(SnmpMonitor, "probeHardwareIdentity")
    .mockImplementation(async (): Promise<SnmpHardwareIdentity> => {
      return {};
    });
}
