import { describe, expect, test } from "@jest/globals";
import XcpNgCollectionSettings, {
  DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  XCP_NG_API_TOKEN_WARNING_DAYS,
  XcpNgSecretBinding,
} from "../../../Utils/XcpNg/XcpNgCollectionSettings";

/*
 * The rules an XCP-ng connection's settings are held to wherever they are
 * written (#10996, #10999): how often it is read, which probe may read it,
 * and - the secrets being write-only - where a saved secret may be sent.
 */

const PROJECT_ID: string = "7c0e9d1a-1111-4b2c-8d3e-000000000001";
const OTHER_PROJECT_ID: string = "7c0e9d1a-1111-4b2c-8d3e-000000000002";
const FINGERPRINT_A: string =
  "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA";
const FINGERPRINT_B: string = FINGERPRINT_A.replace(/A/g, "B");

const SAVED: XcpNgSecretBinding = {
  endpointKey: "xo.example.com:443",
  probeId: "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0001",
  trustedCertificateFingerprint: FINGERPRINT_A,
};

describe("XcpNgCollectionSettings.getIntervalRefusal", () => {
  test("takes whole minutes from 1 to 60, every minute by default, as the agent reads", () => {
    expect(DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES).toBe(1);
    expect(MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES).toBe(1);
    expect(MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES).toBe(60);

    for (const value of [1, 2, 30, 60]) {
      expect(XcpNgCollectionSettings.getIntervalRefusal(value)).toBeNull();
    }
  });

  test.each([[0], [61], [1.5], [-1], ["5"], [null], [Number.NaN]])(
    "refuses %p",
    (value: unknown) => {
      expect(XcpNgCollectionSettings.getIntervalRefusal(value)).toContain(
        "1 to 60 minutes",
      );
    },
  );
});

describe("XcpNgCollectionSettings.getProbeRefusal", () => {
  test("lets the project's own probe read it", () => {
    expect(
      XcpNgCollectionSettings.getProbeRefusal({
        probe: { isGlobalProbe: false, projectId: PROJECT_ID },
        projectId: PROJECT_ID,
        isBillingEnabled: true,
      }),
    ).toBeNull();
  });

  test("never hands secrets to a shared probe on OneUptime Cloud", () => {
    expect(
      XcpNgCollectionSettings.getProbeRefusal({
        probe: { isGlobalProbe: true, projectId: null },
        projectId: PROJECT_ID,
        isBillingEnabled: true,
      }),
    ).toContain("Shared probes never receive XCP-ng secrets");
  });

  test("lets a self-hosted instance's own probes read it", () => {
    expect(
      XcpNgCollectionSettings.getProbeRefusal({
        probe: { isGlobalProbe: true, projectId: null },
        projectId: PROJECT_ID,
        isBillingEnabled: false,
      }),
    ).toBeNull();
  });

  test("refuses another project's probe, everywhere", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        XcpNgCollectionSettings.getProbeRefusal({
          probe: { isGlobalProbe: false, projectId: OTHER_PROJECT_ID },
          projectId: PROJECT_ID,
          isBillingEnabled: isBillingEnabled,
        }),
      ).toContain("another project");
    }
  });
});

describe("XcpNgCollectionSettings.getSecretRebindRefusal", () => {
  const refusal: (next: Partial<XcpNgSecretBinding>) => string | null = (
    next: Partial<XcpNgSecretBinding>,
  ): string | null => {
    return XcpNgCollectionSettings.getSecretRebindRefusal({
      saved: SAVED,
      next: { ...SAVED, ...next },
      secretName: "the secret",
    });
  };

  test("keeps the saved secret where it was entered for", () => {
    expect(refusal({})).toBeNull();
    // The same certificate, written another way.
    expect(
      refusal({
        trustedCertificateFingerprint: FINGERPRINT_A.toLowerCase().replace(
          /:/g,
          "",
        ),
      }),
    ).toBeNull();
  });

  test("asks for it again for another address, probe or certificate", () => {
    expect(refusal({ endpointKey: "evil.example.com:443" })).toContain(
      "address",
    );
    expect(refusal({ endpointKey: "xo.example.com:8443" })).toContain(
      "address",
    );
    expect(
      refusal({ probeId: "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0002" }),
    ).toContain("probe");
    expect(refusal({ trustedCertificateFingerprint: FINGERPRINT_B })).toContain(
      "certificate",
    );
  });

  test("keeps it when only publicly trusted certificates are accepted from now on, which is stricter", () => {
    expect(refusal({ trustedCertificateFingerprint: null })).toBeNull();
  });

  test("names what is asked for again", () => {
    expect(
      XcpNgCollectionSettings.getSecretRebindRefusal({
        saved: SAVED,
        next: { ...SAVED, endpointKey: "other:443" },
        secretName: "the password",
      }),
    ).toMatch(/^Enter the password again/);
  });
});

describe("XcpNgCollectionSettings.isSameBinding", () => {
  test("is the same place only for the same address, probe and certificate", () => {
    expect(XcpNgCollectionSettings.isSameBinding(SAVED, { ...SAVED })).toBe(
      true,
    );
    expect(
      XcpNgCollectionSettings.isSameBinding(SAVED, {
        ...SAVED,
        trustedCertificateFingerprint: null,
      }),
    ).toBe(false);
    expect(
      XcpNgCollectionSettings.isSameBinding(SAVED, {
        ...SAVED,
        probeId: null,
      }),
    ).toBe(false);
  });
});

describe("API token expiry", () => {
  const NOW: Date = new Date("2026-11-18T07:00:00.000Z");
  const inDays: (days: number) => Date = (days: number): Date => {
    return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
  };

  test(`warns within ${XCP_NG_API_TOKEN_WARNING_DAYS} days of it, not before and not after`, () => {
    expect(XCP_NG_API_TOKEN_WARNING_DAYS).toBe(14);
    expect(
      XcpNgCollectionSettings.isApiTokenExpiringSoon({
        expiresAt: inDays(13),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      XcpNgCollectionSettings.isApiTokenExpiringSoon({
        expiresAt: inDays(14),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      XcpNgCollectionSettings.isApiTokenExpiringSoon({
        expiresAt: inDays(15),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      XcpNgCollectionSettings.isApiTokenExpiringSoon({
        expiresAt: inDays(-1),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("reads an ISO string as a date, and nothing as no expiry", () => {
    expect(
      XcpNgCollectionSettings.isApiTokenExpiringSoon({
        expiresAt: inDays(3).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      XcpNgCollectionSettings.isApiTokenExpiringSoon({
        expiresAt: null,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      XcpNgCollectionSettings.isApiTokenExpired({
        expiresAt: "not a date",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("is expired from the moment it expires", () => {
    expect(
      XcpNgCollectionSettings.isApiTokenExpired({ expiresAt: NOW, now: NOW }),
    ).toBe(true);
    expect(
      XcpNgCollectionSettings.isApiTokenExpired({
        expiresAt: inDays(0.001),
        now: NOW,
      }),
    ).toBe(false);
  });
});
