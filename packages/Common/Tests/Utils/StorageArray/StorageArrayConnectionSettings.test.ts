import { describe, expect, test } from "@jest/globals";
import POWERMAX_PROBE_COLLECTOR from "../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxProbeCollector";
import StorageArrayConnectionSettings, {
  MAX_STORAGE_ARRAY_PASSWORD_LENGTH,
  MAX_STORAGE_ARRAY_USERNAME_LENGTH,
  StorageArrayPasswordBinding,
} from "../../../Utils/StorageArray/StorageArrayConnectionSettings";

/*
 * The rules a storage array connection's settings follow (#11004), the
 * dashboard's, the server's and the probe's alike: how often it may be
 * read, which probes may receive its password, and when keeping the saved
 * password would send it somewhere it was not entered for.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT: string = "22222222-2222-4222-8222-222222222222";

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const OTHER_FINGERPRINT: string =
  "01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF";

describe("how often a connection is read", () => {
  test("every 5 to 10 whole minutes for PowerMax: Unisphere computes performance every 5", () => {
    for (const minutes of [5, 6, 10]) {
      expect(
        StorageArrayConnectionSettings.getIntervalRefusal(
          minutes,
          POWERMAX_PROBE_COLLECTOR,
        ),
      ).toBeNull();
    }
    for (const value of [4, 11, 0, -5, 5.5, "5", null, undefined, Number.NaN]) {
      expect(
        StorageArrayConnectionSettings.getIntervalRefusal(
          value,
          POWERMAX_PROBE_COLLECTOR,
        ),
      ).toBe("Collect every 5 to 10\u00a0minutes, in whole minutes.");
    }
  });

  test("a stored interval out of bounds reads as the platform's default", () => {
    expect(
      StorageArrayConnectionSettings.getSafeInterval(
        10,
        POWERMAX_PROBE_COLLECTOR,
      ),
    ).toBe(10);
    for (const value of [1, 60, null, undefined]) {
      expect(
        StorageArrayConnectionSettings.getSafeInterval(
          value,
          POWERMAX_PROBE_COLLECTOR,
        ),
      ).toBe(5);
    }
  });
});

describe("which probes may receive a connection's password", () => {
  test("the project's own, anywhere", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        StorageArrayConnectionSettings.getProbeRefusal({
          probe: { isGlobalProbe: false, projectId: PROJECT },
          projectId: PROJECT,
          isBillingEnabled,
        }),
      ).toBeNull();
    }
  });

  test("never another project's", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        StorageArrayConnectionSettings.getProbeRefusal({
          probe: { isGlobalProbe: false, projectId: OTHER_PROJECT },
          projectId: PROJECT,
          isBillingEnabled,
        }),
      ).toBe(
        "This probe belongs to another project. Pick one of this project's probes.",
      );
    }
  });

  test("a global probe only where it is the operator's own (billing off)", () => {
    for (const probe of [
      { isGlobalProbe: true, projectId: null },
      { isGlobalProbe: false, projectId: null },
    ]) {
      expect(
        StorageArrayConnectionSettings.getProbeRefusal({
          probe,
          projectId: PROJECT,
          isBillingEnabled: true,
        }),
      ).toBe(
        "Pick a probe of your own. Shared probes never receive storage passwords - add a probe in the storage network and pick it here.",
      );
      expect(
        StorageArrayConnectionSettings.getProbeRefusal({
          probe,
          projectId: PROJECT,
          isBillingEnabled: false,
        }),
      ).toBeNull();
    }
  });
});

describe("when the saved password may be kept", () => {
  const saved: StorageArrayPasswordBinding = {
    endpointKey: "unisphere.example.com:8443",
    probeId: "probe-1",
    trustedCertificateFingerprint: FINGERPRINT,
  };

  test("nothing it is bound to changed", () => {
    expect(
      StorageArrayConnectionSettings.getPasswordRebindRefusal({
        saved,
        next: { ...saved },
      }),
    ).toBeNull();
  });

  test("the same fingerprint written otherwise is the same certificate", () => {
    expect(
      StorageArrayConnectionSettings.getPasswordRebindRefusal({
        saved,
        next: {
          ...saved,
          trustedCertificateFingerprint: FINGERPRINT.replace(
            /:/g,
            "",
          ).toLowerCase(),
        },
      }),
    ).toBeNull();
  });

  test("going back to publicly trusted certificates only is stricter, and keeps it", () => {
    expect(
      StorageArrayConnectionSettings.getPasswordRebindRefusal({
        saved,
        next: { ...saved, trustedCertificateFingerprint: null },
      }),
    ).toBeNull();
  });

  test("another address asks for it again", () => {
    expect(
      StorageArrayConnectionSettings.getPasswordRebindRefusal({
        saved,
        next: { ...saved, endpointKey: "attacker.example.com:8443" },
      }),
    ).toBe(
      "Enter the password again: a saved password is only sent to the address it was entered for.",
    );
    expect(
      StorageArrayConnectionSettings.getPasswordRebindRefusal({
        saved,
        next: { ...saved, endpointKey: "unisphere.example.com:9443" },
      }),
    ).not.toBeNull();
  });

  test("another probe asks for it again", () => {
    expect(
      StorageArrayConnectionSettings.getPasswordRebindRefusal({
        saved,
        next: { ...saved, probeId: "probe-2" },
      }),
    ).toBe(
      "Enter the password again: a saved password is only sent through the probe it was entered for.",
    );
  });

  test("trusting another certificate asks for it again", () => {
    expect(
      StorageArrayConnectionSettings.getPasswordRebindRefusal({
        saved,
        next: { ...saved, trustedCertificateFingerprint: OTHER_FINGERPRINT },
      }),
    ).toBe(
      "Enter the password again: a saved password is only sent to the certificate that was trusted when it was entered.",
    );
    // Trusting one where none was trusted is another certificate too.
    expect(
      StorageArrayConnectionSettings.getPasswordRebindRefusal({
        saved: { ...saved, trustedCertificateFingerprint: null },
        next: saved,
      }),
    ).not.toBeNull();
  });
});

describe("the account's lengths", () => {
  test("a user name and a password fit a Unisphere account's", () => {
    expect(MAX_STORAGE_ARRAY_USERNAME_LENGTH).toBe(256);
    expect(MAX_STORAGE_ARRAY_PASSWORD_LENGTH).toBe(256);
  });
});
