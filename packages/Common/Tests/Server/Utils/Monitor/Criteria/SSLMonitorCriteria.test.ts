import SSLMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SSLMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import CertificateRevocationCheckMethod from "../../../../../Types/Monitor/SSLMonitor/CertificateRevocationCheckMethod";
import CertificateRevocationStatus from "../../../../../Types/Monitor/SSLMonitor/CertificateRevocationStatus";
import SslMonitorResponse from "../../../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";

function dateFromNow(input: { days?: number; hours?: number }): Date {
  const ms: number =
    (input.days ?? 0) * 24 * 60 * 60 * 1000 +
    (input.hours ?? 0) * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

function buildDataToProcess(input: {
  isOnline?: boolean;
  isTimeout?: boolean;
  sslResponse?: SslMonitorResponse | undefined;
  includeSslResponse?: boolean;
}): ProbeMonitorResponse {
  const includeSsl: boolean = input.includeSslResponse ?? true;

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: input.isOnline ?? true,
    isTimeout: input.isTimeout,
    responseTimeInMs: 42,
    sslResponse: includeSsl ? input.sslResponse : undefined,
    monitoredAt: new Date(),
  };
}

async function evaluate(
  dataToProcess: ProbeMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess,
    criteriaFilter,
  });
}

describe("SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  describe("IsOnline", () => {
    test("online + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("online + False → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("offline + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: false }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });
  });

  describe("IsRequestTimeout", () => {
    test("timed out + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: false, isTimeout: true }),
        {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("did not time out + True → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, isTimeout: false }),
        {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("IsValidCertificate", () => {
    /*
     * A certificate counts as valid only when the host is online, the response
     * carries an expiry that is still in the future, and the cert is not
     * self-signed.
     */
    test("valid cert + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            expiresAt: dateFromNow({ days: 30 }),
            isSelfSigned: false,
          },
        }),
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBe("SSL certificate is valid.");
    });

    test("self-signed cert is not valid + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            expiresAt: dateFromNow({ days: 30 }),
            isSelfSigned: true,
          },
        }),
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      // The reason is appended so the root cause reaches whoever is paged.
      expect(result).toContain("SSL certificate is not valid");
      expect(result).toContain("self signed");
    });

    test("valid cert + False → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            expiresAt: dateFromNow({ days: 30 }),
            isSelfSigned: false,
          },
        }),
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("offline host makes the cert invalid + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: false,
          sslResponse: {
            expiresAt: dateFromNow({ days: 30 }),
            isSelfSigned: false,
          },
        }),
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toContain("not reachable");
    });
  });

  describe("IsSelfSignedCertificate", () => {
    test("self-signed + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          sslResponse: { isSelfSigned: true },
        }),
        {
          checkOn: CheckOn.IsSelfSignedCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBe("SSL Certificate is self signed.");
    });

    test("not self-signed + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          sslResponse: { isSelfSigned: false },
        }),
        {
          checkOn: CheckOn.IsSelfSignedCertificate,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBe("SSL Certificate is not self signed.");
    });

    test("no ssl response counts as not self-signed + True → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ includeSslResponse: false }),
        {
          checkOn: CheckOn.IsSelfSignedCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("IsExpiredCertificate", () => {
    test("expired cert + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          sslResponse: { expiresAt: dateFromNow({ days: -1 }) },
        }),
        {
          checkOn: CheckOn.IsExpiredCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBe("SSL certificate is expired.");
    });

    test("not-yet-expired cert + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          sslResponse: { expiresAt: dateFromNow({ days: 30 }) },
        }),
        {
          checkOn: CheckOn.IsExpiredCertificate,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBe("SSL certificate is not expired.");
    });

    /*
     * With no expiry present the cert cannot be judged expired, so a False
     * filter still reports "not expired".
     */
    test("no expiry present + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ sslResponse: {} }),
        {
          checkOn: CheckOn.IsExpiredCertificate,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBe("SSL certificate is not expired.");
    });
  });

  describe("IsNotAValidCertificate", () => {
    test("expired cert is not valid + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            expiresAt: dateFromNow({ days: -1 }),
            isSelfSigned: false,
          },
        }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain("SSL certificate is not valid");
      expect(result).toContain("expired");
    });

    test("healthy cert + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            expiresAt: dateFromNow({ days: 30 }),
            isSelfSigned: false,
          },
        }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBe("SSL certificate is valid.");
    });

    test("missing ssl response is treated as not valid + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, includeSslResponse: false }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain("SSL certificate is not valid");
    });
  });

  /*
   * A certificate its issuer has revoked passes every check Node's TLS
   * stack makes, so before the probe asked the issuer (OCSP, then the CRL)
   * a monitor stayed green on a certificate browsers refused with
   * SEC_ERROR_REVOKED_CERTIFICATE. The probe now records the issuer's
   * answer; these hold the criteria to it.
   */
  describe("IsRevokedCertificate", () => {
    const REVOKED_AT: string = "2026-11-10T08:00:00.000Z";
    // The same moment, as the probe and the criteria write it.
    const REVOKED_AT_TEXT: string = "2026-11-10 08:00:00 UTC";

    // A revoked certificate, as the probe reports one.
    function revokedResponse(
      overrides: Partial<SslMonitorResponse> = {},
    ): SslMonitorResponse {
      return {
        isValidCertificate: false,
        isSelfSigned: false,
        certificateValidationErrorCode: "CERT_REVOKED",
        certificateValidationError: `certificate has been revoked by its issuer on ${REVOKED_AT_TEXT} (reason: Key Compromise)`,
        revocationStatus: CertificateRevocationStatus.Revoked,
        revocationCheckMethod: CertificateRevocationCheckMethod.Ocsp,
        revokedAt: new Date(REVOKED_AT),
        revocationReason: "Key Compromise",
        expiresAt: dateFromNow({ days: 60 }),
        ...overrides,
      };
    }

    function notRevokedResponse(
      overrides: Partial<SslMonitorResponse> = {},
    ): SslMonitorResponse {
      return {
        isValidCertificate: true,
        isSelfSigned: false,
        certificateValidationErrorCode: "",
        certificateValidationError: "",
        revocationStatus: CertificateRevocationStatus.NotRevoked,
        revocationCheckMethod: CertificateRevocationCheckMethod.StapledOcsp,
        expiresAt: dateFromNow({ days: 60 }),
        ...overrides,
      };
    }

    async function isRevoked(
      sslResponse: SslMonitorResponse | undefined,
      filterType: FilterType,
    ): Promise<string | null> {
      return evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: sslResponse,
          includeSslResponse: Boolean(sslResponse),
        }),
        {
          checkOn: CheckOn.IsRevokedCertificate,
          filterType: filterType,
          value: undefined,
        },
      );
    }

    test("revoked + True → met, naming when and why the issuer revoked it", async () => {
      expect(await isRevoked(revokedResponse(), FilterType.True)).toBe(
        `SSL certificate has been revoked by its issuer on ${REVOKED_AT_TEXT} (reason: Key Compromise).`,
      );
    });

    test("revoked + False → not met", async () => {
      expect(await isRevoked(revokedResponse(), FilterType.False)).toBeNull();
    });

    test("not revoked + False → met", async () => {
      expect(await isRevoked(notRevokedResponse(), FilterType.False)).toBe(
        "SSL certificate is not revoked.",
      );
    });

    test("not revoked + True → not met", async () => {
      expect(await isRevoked(notRevokedResponse(), FilterType.True)).toBeNull();
    });

    /*
     * Unknown: no signed answer could be had (no responder named, none
     * reachable, nothing verifiable). Like a browser, that is no revocation,
     * or a probe without internet access would flag every certificate.
     */
    test("a status that could not be checked counts as not revoked", async () => {
      const unknown: SslMonitorResponse = notRevokedResponse({
        revocationStatus: CertificateRevocationStatus.Unknown,
        revocationCheckMethod: undefined,
        revocationCheckError: "No OCSP responder answered within 5 seconds.",
      });

      expect(await isRevoked(unknown, FilterType.True)).toBeNull();
      expect(await isRevoked(unknown, FilterType.False)).toBe(
        "SSL certificate is not revoked.",
      );
    });

    /*
     * No status at all: the check did not run (another validation failure,
     * the probe has it turned off, or the probe is older than the check).
     */
    test("no status counts as not revoked", async () => {
      const unchecked: SslMonitorResponse = notRevokedResponse({
        revocationStatus: undefined,
        revocationCheckMethod: undefined,
      });

      expect(await isRevoked(unchecked, FilterType.True)).toBeNull();
      expect(await isRevoked(unchecked, FilterType.False)).toBe(
        "SSL certificate is not revoked.",
      );
    });

    test("no ssl response counts as not revoked", async () => {
      expect(await isRevoked(undefined, FilterType.True)).toBeNull();
      expect(await isRevoked(undefined, FilterType.False)).toBe(
        "SSL certificate is not revoked.",
      );
    });

    test("the reason leaves out what the issuer did not say", async () => {
      expect(
        await isRevoked(
          revokedResponse({
            revokedAt: undefined,
            revocationReason: undefined,
          }),
          FilterType.True,
        ),
      ).toBe("SSL certificate has been revoked by its issuer.");

      expect(
        await isRevoked(
          revokedResponse({ revokedAt: undefined }),
          FilterType.True,
        ),
      ).toBe(
        "SSL certificate has been revoked by its issuer (reason: Key Compromise).",
      );

      expect(
        await isRevoked(
          revokedResponse({ revocationReason: "  " }),
          FilterType.True,
        ),
      ).toBe(
        `SSL certificate has been revoked by its issuer on ${REVOKED_AT_TEXT}.`,
      );
    });

    // The probe's response reaches the server as JSON: a date is a string.
    test("the revocation date arriving as an ISO string reads the same", async () => {
      expect(
        await isRevoked(
          revokedResponse({ revokedAt: REVOKED_AT as unknown as Date }),
          FilterType.True,
        ),
      ).toBe(
        `SSL certificate has been revoked by its issuer on ${REVOKED_AT_TEXT} (reason: Key Compromise).`,
      );
    });

    test("a revocation date that cannot be read is left out, not shown as Invalid Date", async () => {
      expect(
        await isRevoked(
          revokedResponse({ revokedAt: 12345 as unknown as Date }),
          FilterType.True,
        ),
      ).toBe(
        "SSL certificate has been revoked by its issuer (reason: Key Compromise).",
      );
    });

    /*
     * A revoked certificate is also not valid, so the default criteria -
     * "Is Not A Valid Certificate" takes the monitor offline - catch it with
     * no change, and their root cause says it was revoked.
     */
    test("a revoked certificate fails IsValidCertificate", async () => {
      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        isOnline: true,
        sslResponse: revokedResponse(),
      });

      expect(
        await evaluate(dataToProcess, {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        }),
      ).toBeNull();

      expect(
        await evaluate(dataToProcess, {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.False,
          value: undefined,
        }),
      ).toContain("revoked");
    });

    test("a revoked certificate satisfies IsNotAValidCertificate, and the root cause says when and why", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, sslResponse: revokedResponse() }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBe(
        `SSL certificate is not valid: certificate has been revoked by its issuer on ${REVOKED_AT_TEXT} (reason: Key Compromise)`,
      );
    });

    // Should a probe ever report the status without the validation error.
    test("the root cause names a revocation even without the probe's validation error", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: revokedResponse({
            certificateValidationError: undefined,
          }),
        }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBe(
        `SSL certificate is not valid: the certificate has been revoked by its issuer on ${REVOKED_AT_TEXT} (reason: Key Compromise).`,
      );
    });

    test("a certificate the issuer did not revoke stays valid", async () => {
      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        isOnline: true,
        sslResponse: notRevokedResponse(),
      });

      expect(
        await evaluate(dataToProcess, {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        }),
      ).toBe("SSL certificate is valid.");

      expect(
        await evaluate(dataToProcess, {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        }),
      ).toBeNull();
    });
  });

  describe("ExpiresInHours", () => {
    test("~48h left + LessThan 72 → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          sslResponse: { expiresAt: dateFromNow({ hours: 48 }) },
        }),
        {
          checkOn: CheckOn.ExpiresInHours,
          filterType: FilterType.LessThan,
          value: 72,
        },
      );

      expect(result).toBeTruthy();
    });

    test("~48h left + GreaterThan 72 → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          sslResponse: { expiresAt: dateFromNow({ hours: 48 }) },
        }),
        {
          checkOn: CheckOn.ExpiresInHours,
          filterType: FilterType.GreaterThan,
          value: 72,
        },
      );

      expect(result).toBeNull();
    });

    // A falsy (zero) or unparseable threshold makes the filter undecidable.
    test("zero threshold → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          sslResponse: { expiresAt: dateFromNow({ hours: 48 }) },
        }),
        {
          checkOn: CheckOn.ExpiresInHours,
          filterType: FilterType.LessThan,
          value: 0,
        },
      );

      expect(result).toBeNull();
    });

    test("no expiry present → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ sslResponse: {} }),
        {
          checkOn: CheckOn.ExpiresInHours,
          filterType: FilterType.LessThan,
          value: 72,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("ExpiresInDays", () => {
    test("~10 days left + LessThan 30 → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          sslResponse: { expiresAt: dateFromNow({ days: 10 }) },
        }),
        {
          checkOn: CheckOn.ExpiresInDays,
          filterType: FilterType.LessThan,
          value: 30,
        },
      );

      expect(result).toBeTruthy();
    });

    test("~90 days left + LessThan 30 → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          sslResponse: { expiresAt: dateFromNow({ days: 90 }) },
        }),
        {
          checkOn: CheckOn.ExpiresInDays,
          filterType: FilterType.LessThan,
          value: 30,
        },
      );

      expect(result).toBeNull();
    });

    test("no expiry present → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ sslResponse: {} }),
        {
          checkOn: CheckOn.ExpiresInDays,
          filterType: FilterType.LessThan,
          value: 30,
        },
      );

      expect(result).toBeNull();
    });
  });

  test("an unrelated CheckOn is not claimed by this evaluator", async () => {
    const result: string | null = await evaluate(
      buildDataToProcess({ sslResponse: {} }),
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.LessThan,
        value: 1000,
      },
    );

    expect(result).toBeNull();
  });

  /*
   * Regression suite for https://github.com/OneUptime/oneuptime/issues/3225.
   *
   * The reported monitor pointed at a host with an invalid certificate and
   * sat Operational forever. Two things made that possible:
   *
   *  1. IsValidCertificate and IsNotAValidCertificate were computed
   *     independently, so BOTH came out false whenever expiresAt was
   *     missing or unparseable. No criterion matched, and a monitor already
   *     at its default status writes no timeline entry when nothing
   *     matches - so the check left no trace at all.
   *
   *  2. The verdict was inferred from !isSelfSigned, and the probe labelled
   *     every validation failure "self signed". A certificate that failed
   *     for any other reason could not be described.
   */
  describe("certificate validity (issue #3225)", () => {
    const failureModes: Array<{ name: string; response: SslMonitorResponse }> =
      [
        {
          name: "self-signed",
          response: {
            isValidCertificate: false,
            isSelfSigned: true,
            certificateValidationErrorCode: "DEPTH_ZERO_SELF_SIGNED_CERT",
            certificateValidationError: "self signed certificate",
            expiresAt: dateFromNow({ days: 100 }),
          },
        },
        {
          name: "hostname mismatch",
          response: {
            isValidCertificate: false,
            isSelfSigned: false,
            certificateValidationErrorCode: "ERR_TLS_CERT_ALTNAME_INVALID",
            certificateValidationError: "Hostname/IP does not match",
            expiresAt: dateFromNow({ days: 100 }),
          },
        },
        {
          name: "untrusted CA",
          response: {
            isValidCertificate: false,
            isSelfSigned: false,
            certificateValidationErrorCode: "SELF_SIGNED_CERT_IN_CHAIN",
            certificateValidationError: "self signed certificate in chain",
            expiresAt: dateFromNow({ days: 100 }),
          },
        },
        {
          name: "expired",
          response: {
            isValidCertificate: false,
            isSelfSigned: false,
            certificateValidationErrorCode: "CERT_HAS_EXPIRED",
            certificateValidationError: "certificate has expired",
            expiresAt: dateFromNow({ days: -5 }),
          },
        },
        {
          name: "incomplete chain",
          response: {
            isValidCertificate: false,
            isSelfSigned: false,
            certificateValidationErrorCode: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
            certificateValidationError:
              "unable to verify the first certificate",
            expiresAt: dateFromNow({ days: 100 }),
          },
        },
      ];

    test.each(failureModes)(
      "$name: IsNotAValidCertificate + True → met",
      async ({ response }: { response: SslMonitorResponse }) => {
        const result: string | null = await evaluate(
          buildDataToProcess({ isOnline: true, sslResponse: response }),
          {
            checkOn: CheckOn.IsNotAValidCertificate,
            filterType: FilterType.True,
            value: undefined,
          },
        );

        expect(result).toBeTruthy();
      },
    );

    test.each(failureModes)(
      "$name: IsValidCertificate + True → not met",
      async ({ response }: { response: SslMonitorResponse }) => {
        const result: string | null = await evaluate(
          buildDataToProcess({ isOnline: true, sslResponse: response }),
          {
            checkOn: CheckOn.IsValidCertificate,
            filterType: FilterType.True,
            value: undefined,
          },
        );

        expect(result).toBeNull();
      },
    );

    test.each(failureModes)(
      "$name: IsValidCertificate + False → met",
      async ({ response }: { response: SslMonitorResponse }) => {
        const result: string | null = await evaluate(
          buildDataToProcess({ isOnline: true, sslResponse: response }),
          {
            checkOn: CheckOn.IsValidCertificate,
            filterType: FilterType.False,
            value: undefined,
          },
        );

        expect(result).toBeTruthy();
      },
    );

    test("the two predicates are exact complements, even with no expiry", async () => {
      /*
       * The silent-healthy case: a certificate the probe could not fully
       * read. Before the fix BOTH of these returned null and the monitor
       * recorded nothing.
       */
      const response: SslMonitorResponse = {
        isValidCertificate: false,
        isSelfSigned: false,
        certificateValidationErrorCode: "UNABLE_TO_GET_ISSUER_CERT",
        certificateValidationError: "unable to get issuer certificate",
        // deliberately no expiresAt
      };

      const isValid: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, sslResponse: response }),
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      const isNotValid: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, sslResponse: response }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(isValid).toBeNull();
      expect(isNotValid).toBeTruthy();
    });

    test("a valid certificate satisfies IsValidCertificate and not its negation", async () => {
      const response: SslMonitorResponse = {
        isValidCertificate: true,
        isSelfSigned: false,
        certificateValidationErrorCode: "",
        certificateValidationError: "",
        expiresAt: dateFromNow({ days: 90 }),
      };

      const isValid: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, sslResponse: response }),
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      const isNotValid: string | null = await evaluate(
        buildDataToProcess({ isOnline: true, sslResponse: response }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(isValid).toBeTruthy();
      expect(isNotValid).toBeNull();
    });

    test("the reason names the underlying validation error", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            isValidCertificate: false,
            isSelfSigned: false,
            certificateValidationErrorCode: "ERR_TLS_CERT_ALTNAME_INVALID",
            certificateValidationError: "Hostname/IP does not match",
            expiresAt: dateFromNow({ days: 100 }),
          },
        }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      // The root cause has to reach whoever gets paged.
      expect(result).toContain("Hostname/IP does not match");
    });

    test("an unreachable endpoint is not a valid certificate", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: false,
          sslResponse: { isValidCertificate: false },
        }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("only genuine self-signed responses satisfy IsSelfSignedCertificate", async () => {
      const mismatch: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            isValidCertificate: false,
            isSelfSigned: false,
            certificateValidationErrorCode: "ERR_TLS_CERT_ALTNAME_INVALID",
            expiresAt: dateFromNow({ days: 100 }),
          },
        }),
        {
          checkOn: CheckOn.IsSelfSignedCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      /*
       * Pre-fix the probe set isSelfSigned=true for a hostname mismatch, so
       * this criterion fired on a certificate that was not self-signed at
       * all.
       */
      expect(mismatch).toBeNull();
    });
  });

  /*
   * Payloads written by a probe running an older build carry no
   * isValidCertificate field. They must keep evaluating exactly as before,
   * or upgrading the server would flip healthy monitors to Down.
   */
  describe("legacy payloads without an explicit verdict", () => {
    test("a healthy legacy response is still valid", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            isSelfSigned: false,
            expiresAt: dateFromNow({ days: 60 }),
          },
        }),
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("a legacy self-signed response is still not valid", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            isSelfSigned: true,
            expiresAt: dateFromNow({ days: 60 }),
          },
        }),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("a legacy expired response is still not valid", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            isSelfSigned: false,
            expiresAt: dateFromNow({ days: -1 }),
          },
        }),
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });
  });

  /*
   * The probe serialises Dates to ISO strings over the wire, so by the time
   * criteria run, expiresAt is a string rather than a Date. Expiry maths
   * must behave identically either way.
   */
  describe("expiresAt arriving as an ISO string", () => {
    test("a future expiry read from a string is still valid", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            isValidCertificate: true,
            isSelfSigned: false,
            expiresAt: dateFromNow({
              days: 30,
            }).toISOString() as unknown as Date,
          },
        }),
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("ExpiresInDays compares correctly against a string expiry", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          sslResponse: {
            isValidCertificate: true,
            expiresAt: dateFromNow({
              days: 10,
            }).toISOString() as unknown as Date,
          },
        }),
        {
          checkOn: CheckOn.ExpiresInDays,
          filterType: FilterType.LessThan,
          value: 30,
        },
      );

      expect(result).toBeTruthy();
    });
  });
});
