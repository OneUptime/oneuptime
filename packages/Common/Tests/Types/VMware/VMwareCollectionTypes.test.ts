import { describe, expect, test } from "@jest/globals";
import VMwareCollectionErrorCode, {
  VMwareCollectionErrorAdvice,
  VMwareCollectionErrorUtil,
} from "../../../Types/VMware/VMwareCollectionError";
import VMwareCollectionMethod, {
  VMwareCollectionMethodUtil,
} from "../../../Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus, {
  VMwareCollectionStatusUtil,
} from "../../../Types/VMware/VMwareCollectionStatus";
import VMwareConnectionTestStatus, {
  MAX_ACTIVE_VMWARE_CONNECTION_TESTS_PER_PROJECT,
  SETTLED_VMWARE_CONNECTION_TEST_STATUSES,
  VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "../../../Types/VMware/VMwareConnectionTestStatus";
import {
  VMWARE_COLLECTION_MAX_PAYLOAD_BYTES,
  VMWARE_PROBE_COLLECTION_CONCURRENCY,
  VMWARE_PROBE_TEST_BATCH_SIZE,
  VMWARE_PROBE_WORK_POLL_INTERVAL_IN_SECONDS,
} from "../../../Types/VMware/VMwareProbeCollection";

/*
 * The stored codes and statuses of probe collection. They are stored
 * strings: renaming one would orphan every row that holds it.
 */

describe("VMwareCollectionErrorCode", () => {
  test("the stored codes are exactly these", () => {
    expect(VMwareCollectionErrorUtil.getAll()).toEqual([
      "InvalidAddress",
      "AddressNotAllowed",
      "AddressNotFound",
      "ConnectionRefused",
      "ConnectionTimedOut",
      "ConnectionFailed",
      "TlsFailed",
      "UntrustedCertificate",
      "CertificateChanged",
      "NotVSphere",
      "InvalidLogin",
      "NoPermission",
      "ApiError",
      "TimedOut",
      "PayloadTooLarge",
      "ProbeNotAllowed",
      "ProbeNotAvailable",
      "Internal",
    ]);
  });

  test.each(VMwareCollectionErrorUtil.getAll())(
    "%s has a title and a next step a person can act on",
    (code: VMwareCollectionErrorCode) => {
      const advice: VMwareCollectionErrorAdvice =
        VMwareCollectionErrorUtil.getAdvice(code);

      expect(advice.title.length).toBeGreaterThan(10);
      expect(advice.title.endsWith(".")).toBe(false);
      expect(advice.nextStep.length).toBeGreaterThan(20);
      expect(advice.nextStep.endsWith(".")).toBe(true);
    },
  );

  test("every code's advice is its own", () => {
    const titles: Set<string> = new Set(
      VMwareCollectionErrorUtil.getAll().map(
        (code: VMwareCollectionErrorCode): string => {
          return VMwareCollectionErrorUtil.getAdvice(code).title;
        },
      ),
    );

    expect(titles.size).toBe(VMwareCollectionErrorUtil.getAll().length);
  });

  test("an unknown code gets the unexpected-error advice", () => {
    expect(
      VMwareCollectionErrorUtil.getAdvice(
        "SomethingNew" as VMwareCollectionErrorCode,
      ),
    ).toEqual(
      VMwareCollectionErrorUtil.getAdvice(VMwareCollectionErrorCode.Internal),
    );
  });

  test("validates what a probe reports", () => {
    expect(VMwareCollectionErrorUtil.isValid("InvalidLogin")).toBe(true);
    expect(VMwareCollectionErrorUtil.isValid("invalidlogin")).toBe(false);
    expect(VMwareCollectionErrorUtil.isValid(7)).toBe(false);
    expect(VMwareCollectionErrorUtil.isValid(undefined)).toBe(false);
  });

  test("only the two certificate codes are fixed by trusting a certificate", () => {
    expect(
      VMwareCollectionErrorUtil.getAll().filter(
        (code: VMwareCollectionErrorCode): boolean => {
          return VMwareCollectionErrorUtil.isCertificateTrustProblem(code);
        },
      ),
    ).toEqual([
      VMwareCollectionErrorCode.UntrustedCertificate,
      VMwareCollectionErrorCode.CertificateChanged,
    ]);
    expect(VMwareCollectionErrorUtil.isCertificateTrustProblem(null)).toBe(
      false,
    );
  });
});

describe("VMwareCollectionMethod and VMwareCollectionStatus", () => {
  test("are the stored strings", () => {
    expect(VMwareCollectionMethodUtil.getAll()).toEqual(["Agent", "Probe"]);
    expect(
      VMwareCollectionMethodUtil.isValid(VMwareCollectionMethod.Probe),
    ).toBe(true);
    expect(VMwareCollectionMethodUtil.isValid("probe")).toBe(false);
    expect(VMwareCollectionMethodUtil.isValid(null)).toBe(false);

    expect(VMwareCollectionStatusUtil.getAll()).toEqual([
      "Pending",
      "Succeeded",
      "Failed",
    ]);
    expect(
      VMwareCollectionStatusUtil.isValid(VMwareCollectionStatus.Succeeded),
    ).toBe(true);
    expect(VMwareCollectionStatusUtil.isValid("Running")).toBe(false);
  });
});

describe("connection tests and probe work limits", () => {
  test("a test settles as Succeeded or Failed", () => {
    expect(Object.values(VMwareConnectionTestStatus)).toEqual([
      "Pending",
      "Running",
      "Succeeded",
      "Failed",
    ]);
    expect(SETTLED_VMWARE_CONNECTION_TEST_STATUSES).toEqual([
      VMwareConnectionTestStatus.Succeeded,
      VMwareConnectionTestStatus.Failed,
    ]);
  });

  test("a person waits seconds, not minutes, and a project cannot flood its probe", () => {
    // A probe asks every ten seconds: a test is picked up well within this.
    expect(VMWARE_PROBE_WORK_POLL_INTERVAL_IN_SECONDS).toBe(10);
    expect(VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS).toBeGreaterThan(
      VMWARE_PROBE_WORK_POLL_INTERVAL_IN_SECONDS * 3,
    );
    // The probe's own test deadline is 60 s: the server waits longer.
    expect(VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS).toBeGreaterThan(60);
    expect(MAX_ACTIVE_VMWARE_CONNECTION_TESTS_PER_PROJECT).toBe(5);
    expect(VMWARE_PROBE_TEST_BATCH_SIZE).toBe(5);
    expect(VMWARE_PROBE_COLLECTION_CONCURRENCY).toBe(4);
  });

  test("a collection upload stays under the server's gzip body limit", () => {
    expect(VMWARE_COLLECTION_MAX_PAYLOAD_BYTES).toBe(48 * 1024 * 1024);
    expect(VMWARE_COLLECTION_MAX_PAYLOAD_BYTES).toBeLessThan(50 * 1024 * 1024);
  });
});
