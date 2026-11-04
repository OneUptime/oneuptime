import { describe, expect, test } from "@jest/globals";
import OpenStackCollectionErrorCode, {
  OpenStackCollectionErrorAdvice,
  OpenStackCollectionErrorUtil,
} from "../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod, {
  OpenStackCollectionMethodUtil,
} from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus, {
  OpenStackCollectionStatusUtil,
} from "../../../Types/OpenStack/OpenStackCollectionStatus";
import OpenStackConnectionTestStatus, {
  MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT,
  OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
  SETTLED_OPENSTACK_CONNECTION_TEST_STATUSES,
} from "../../../Types/OpenStack/OpenStackConnectionTestStatus";
import {
  DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES,
  OPENSTACK_CREDENTIAL_KINDS,
  OPENSTACK_ENDPOINT_INTERFACES,
  OPENSTACK_PROBE_COLLECTION_CONCURRENCY,
  OPENSTACK_PROBE_TEST_BATCH_SIZE,
  OPENSTACK_PROBE_WORK_POLL_INTERVAL_IN_SECONDS,
} from "../../../Types/OpenStack/OpenStackProbeCollection";

/*
 * The stored codes and statuses of probe collection. They are stored strings: renaming one
 * would orphan every row that holds it.
 */

describe("OpenStackCollectionErrorCode", () => {
  test("the stored codes are exactly these", () => {
    expect(OpenStackCollectionErrorUtil.getAll()).toEqual([
      "InvalidAddress",
      "AddressNotAllowed",
      "AddressNotFound",
      "ConnectionRefused",
      "ConnectionTimedOut",
      "ConnectionFailed",
      "TlsFailed",
      "UntrustedCertificate",
      "CertificateChanged",
      "InsecureEndpoint",
      "NotKeystone",
      "InvalidCredential",
      "WrongProjectScope",
      "NoCatalog",
      "RegionNotFound",
      "NoPermission",
      "KeystoneFailing",
      "ApiError",
      "ServiceOverloaded",
      "TimedOut",
      "PayloadTooLarge",
      "ProbeNotAllowed",
      "ProbeNotAvailable",
      "Internal",
    ]);
  });

  test.each(OpenStackCollectionErrorUtil.getAll())(
    "%s says what happened and what to do",
    (code: OpenStackCollectionErrorCode) => {
      const advice: OpenStackCollectionErrorAdvice =
        OpenStackCollectionErrorUtil.getAdvice(code);

      expect(advice.title.length).toBeGreaterThan(0);
      expect(advice.nextStep.length).toBeGreaterThan(0);
    },
  );

  test("each says something of its own", () => {
    const titles: Array<string> = OpenStackCollectionErrorUtil.getAll().map(
      (code: OpenStackCollectionErrorCode): string => {
        return OpenStackCollectionErrorUtil.getAdvice(code).title;
      },
    );

    expect(new Set(titles).size).toBe(titles.length);
  });

  test("a code it does not know falls back to the one for a bug", () => {
    expect(
      OpenStackCollectionErrorUtil.getAdvice(
        "Whatever" as OpenStackCollectionErrorCode,
      ),
    ).toEqual(
      OpenStackCollectionErrorUtil.getAdvice(
        OpenStackCollectionErrorCode.Internal,
      ),
    );
  });

  test("what is a code", () => {
    expect(
      OpenStackCollectionErrorUtil.isValid(
        OpenStackCollectionErrorCode.TlsFailed,
      ),
    ).toBe(true);
    expect(OpenStackCollectionErrorUtil.isValid("Whatever")).toBe(false);
    expect(OpenStackCollectionErrorUtil.isValid(7)).toBe(false);
    expect(OpenStackCollectionErrorUtil.isValid(null)).toBe(false);
  });

  test("only the two a person can fix by trusting a certificate say so", () => {
    const trusting: Array<OpenStackCollectionErrorCode> =
      OpenStackCollectionErrorUtil.getAll().filter(
        (code: OpenStackCollectionErrorCode): boolean => {
          return OpenStackCollectionErrorUtil.isCertificateTrustProblem(code);
        },
      );

    expect(trusting).toEqual([
      OpenStackCollectionErrorCode.UntrustedCertificate,
      OpenStackCollectionErrorCode.CertificateChanged,
    ]);
    expect(OpenStackCollectionErrorUtil.isCertificateTrustProblem(null)).toBe(
      false,
    );
  });
});

describe("OpenStackCollectionMethod", () => {
  test("the stored methods are exactly these", () => {
    expect(OpenStackCollectionMethodUtil.getAll()).toEqual(["Agent", "Probe"]);
  });

  test("what is a method", () => {
    expect(
      OpenStackCollectionMethodUtil.isValid(OpenStackCollectionMethod.Probe),
    ).toBe(true);
    expect(OpenStackCollectionMethodUtil.isValid("probe")).toBe(false);
    expect(OpenStackCollectionMethodUtil.isValid(undefined)).toBe(false);
  });
});

describe("OpenStackCollectionStatus", () => {
  test("the stored statuses are exactly these", () => {
    expect(OpenStackCollectionStatusUtil.getAll()).toEqual([
      "Pending",
      "Succeeded",
      "PartiallySucceeded",
      "Failed",
    ]);
  });

  test("what is a status", () => {
    expect(
      OpenStackCollectionStatusUtil.isValid(OpenStackCollectionStatus.Pending),
    ).toBe(true);
    expect(OpenStackCollectionStatusUtil.isValid("Collecting")).toBe(false);
  });

  test("a probe may report what became of a collection, and Pending is only the server's word", () => {
    expect(OpenStackCollectionStatusUtil.isReportable("Succeeded")).toBe(true);
    expect(
      OpenStackCollectionStatusUtil.isReportable("PartiallySucceeded"),
    ).toBe(true);
    expect(OpenStackCollectionStatusUtil.isReportable("Failed")).toBe(true);
    expect(OpenStackCollectionStatusUtil.isReportable("Pending")).toBe(false);
    expect(OpenStackCollectionStatusUtil.isReportable(undefined)).toBe(false);
  });
});

describe("OpenStackConnectionTestStatus", () => {
  test("the stored statuses, and the two nothing more is written to", () => {
    expect(Object.values(OpenStackConnectionTestStatus)).toEqual([
      "Pending",
      "Running",
      "Succeeded",
      "Failed",
    ]);
    expect(SETTLED_OPENSTACK_CONNECTION_TEST_STATUSES).toEqual([
      OpenStackConnectionTestStatus.Succeeded,
      OpenStackConnectionTestStatus.Failed,
    ]);
  });

  test("a person waits this long, and no longer", () => {
    expect(OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS).toBe(90);
    expect(OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS).toBe(180);
    expect(MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT).toBe(5);
  });
});

describe("what a probe and the server agree on", () => {
  test("the conversation's limits", () => {
    expect(OPENSTACK_PROBE_WORK_POLL_INTERVAL_IN_SECONDS).toBe(10);
    expect(OPENSTACK_PROBE_COLLECTION_CONCURRENCY).toBe(4);
    expect(OPENSTACK_PROBE_TEST_BATCH_SIZE).toBe(5);
  });

  test("the largest collection leaves room in the server's 50 MiB for the rest of the report", () => {
    expect(OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES).toBe(48 * 1024 * 1024);
    expect(OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES).toBeLessThan(
      50 * 1024 * 1024,
    );
  });

  test("the catalog's interfaces, public by default", () => {
    expect(OPENSTACK_ENDPOINT_INTERFACES).toEqual([
      "public",
      "internal",
      "admin",
    ]);
    expect(DEFAULT_OPENSTACK_ENDPOINT_INTERFACE).toBe("public");
  });

  test("the kinds of credential, as a row stores them", () => {
    expect(OPENSTACK_CREDENTIAL_KINDS).toEqual([
      "applicationCredential",
      "password",
    ]);
  });
});
