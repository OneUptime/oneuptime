import { describe, expect, test } from "@jest/globals";
import VMwareCollectionSettings, {
  DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  VMwarePasswordBinding,
} from "../../../Utils/VMware/VMwareCollectionSettings";

/*
 * The rules of a probe-collected vCenter's settings: how often, through which
 * probe, and where a saved password may go.
 */

const FINGERPRINT_A: string =
  "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA";
const FINGERPRINT_B: string = FINGERPRINT_A.replace(/A/g, "B");

const SAVED: VMwarePasswordBinding = {
  endpointKey: "vcsa.example.com:443",
  probeId: "probe-1",
  trustedCertificateFingerprint: null,
};

describe("VMwareCollectionSettings.getIntervalRefusal", () => {
  test("whole minutes from one to sixty", () => {
    expect(MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES).toBe(1);
    expect(MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES).toBe(60);
    // The VMware agent's own default, so either way the data is as dense.
    expect(DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES).toBe(2);

    for (const value of [1, 2, 5, 60]) {
      expect(VMwareCollectionSettings.getIntervalRefusal(value)).toBeNull();
    }
  });

  test.each([0, 61, 1.5, -1, Number.NaN, "5", null, undefined])(
    "%p is refused",
    (value: unknown) => {
      expect(VMwareCollectionSettings.getIntervalRefusal(value)).toBe(
        "Collect every 1 to 60 minutes, in whole minutes.",
      );
    },
  );
});

describe("VMwareCollectionSettings.getProbeRefusal", () => {
  test("the project's own probe collects its vCenters", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        VMwareCollectionSettings.getProbeRefusal({
          probe: { isGlobalProbe: false, projectId: "project-1" },
          projectId: "project-1",
          isBillingEnabled: isBillingEnabled,
        }),
      ).toBeNull();
    }
  });

  test("another project's probe never does", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        VMwareCollectionSettings.getProbeRefusal({
          probe: { isGlobalProbe: false, projectId: "project-2" },
          projectId: "project-1",
          isBillingEnabled: isBillingEnabled,
        }),
      ).toBe(
        "This probe belongs to another project. Pick one of this project's probes.",
      );
    }
  });

  test("OneUptime Cloud's shared probes never receive a vCenter password", () => {
    const refusal: string =
      "Pick a probe of your own. Shared probes never receive vCenter passwords - add a probe in vCenter's network and pick it here.";

    expect(
      VMwareCollectionSettings.getProbeRefusal({
        probe: { isGlobalProbe: true, projectId: null },
        projectId: "project-1",
        isBillingEnabled: true,
      }),
    ).toBe(refusal);

    // A probe with no project is a global one, whatever its flag says.
    expect(
      VMwareCollectionSettings.getProbeRefusal({
        probe: { isGlobalProbe: false, projectId: null },
        projectId: "project-1",
        isBillingEnabled: true,
      }),
    ).toBe(refusal);
  });

  test("a self-hosted instance's own global probes may - that is the no-extra-machine case", () => {
    expect(
      VMwareCollectionSettings.getProbeRefusal({
        probe: { isGlobalProbe: true, projectId: null },
        projectId: "project-1",
        isBillingEnabled: false,
      }),
    ).toBeNull();
  });
});

describe("VMwareCollectionSettings.getPasswordRebindRefusal", () => {
  test("the same address, probe and certificate keep the saved password", () => {
    expect(
      VMwareCollectionSettings.getPasswordRebindRefusal({
        saved: SAVED,
        next: { ...SAVED },
      }),
    ).toBeNull();
  });

  test("another address asks for the password again", () => {
    expect(
      VMwareCollectionSettings.getPasswordRebindRefusal({
        saved: SAVED,
        next: { ...SAVED, endpointKey: "attacker.example.com:443" },
      }),
    ).toBe(
      "Enter the password again: a saved password is only sent to the vCenter address it was entered for.",
    );

    // Another port of the same host is another address.
    expect(
      VMwareCollectionSettings.getPasswordRebindRefusal({
        saved: SAVED,
        next: { ...SAVED, endpointKey: "vcsa.example.com:8443" },
      }),
    ).not.toBeNull();
  });

  test("another probe asks for the password again", () => {
    expect(
      VMwareCollectionSettings.getPasswordRebindRefusal({
        saved: SAVED,
        next: { ...SAVED, probeId: "probe-2" },
      }),
    ).toBe(
      "Enter the password again: a saved password is only sent through the probe it was entered for.",
    );
  });

  test("trusting a certificate - or another one - asks for the password again", () => {
    const refusal: string =
      "Enter the password again: a saved password is only sent to the certificate that was trusted when it was entered.";

    expect(
      VMwareCollectionSettings.getPasswordRebindRefusal({
        saved: SAVED,
        next: { ...SAVED, trustedCertificateFingerprint: FINGERPRINT_A },
      }),
    ).toBe(refusal);

    expect(
      VMwareCollectionSettings.getPasswordRebindRefusal({
        saved: { ...SAVED, trustedCertificateFingerprint: FINGERPRINT_A },
        next: { ...SAVED, trustedCertificateFingerprint: FINGERPRINT_B },
      }),
    ).toBe(refusal);
  });

  test("the same certificate in another spelling is the same certificate", () => {
    expect(
      VMwareCollectionSettings.getPasswordRebindRefusal({
        saved: { ...SAVED, trustedCertificateFingerprint: FINGERPRINT_A },
        next: {
          ...SAVED,
          trustedCertificateFingerprint: FINGERPRINT_A.replace(
            /:/g,
            "",
          ).toLowerCase(),
        },
      }),
    ).toBeNull();
  });

  test("going back to publicly trusted certificates only is stricter, and keeps it", () => {
    expect(
      VMwareCollectionSettings.getPasswordRebindRefusal({
        saved: { ...SAVED, trustedCertificateFingerprint: FINGERPRINT_A },
        next: { ...SAVED, trustedCertificateFingerprint: null },
      }),
    ).toBeNull();
  });
});
