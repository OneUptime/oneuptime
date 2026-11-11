import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import SSLMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/SSLMonitorCriteria";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { CheckOn, FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import CertificateRevocationCheckMethod from "../../../../Types/Monitor/SSLMonitor/CertificateRevocationCheckMethod";
import CertificateRevocationStatus from "../../../../Types/Monitor/SSLMonitor/CertificateRevocationStatus";
import SslMonitorResponse from "../../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * What a monitor's evaluation says it found for the SSL certificate checks
 * - the "observed" half of each filter's sentence, beside the root cause the
 * criteria give.
 *
 * Is Valid Certificate and Is Not A Valid Certificate used to infer the
 * verdict from the expiry date and the self-signed flag alone, ignoring the
 * verdict the probe records (isValidCertificate). A certificate its issuer
 * had revoked - or one issued for another host name, or by an authority
 * browsers do not trust - was described as "SSL certificate is valid." while
 * the same criteria took the monitor offline. They now judge as the criteria
 * do (SSLMonitorCriteria.isValidCertificate) and give the criteria's reason.
 */

const REVOKED_AT: string = "2026-11-10T08:00:00.000Z";

// The same moment, as the probe and the criteria write it.

const REVOKED_AT_TEXT: string = "2026-11-10 08:00:00 UTC";

function dateFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function probeResponse(input: {
  isOnline?: boolean;
  sslResponse?: SslMonitorResponse | undefined;
}): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: input.isOnline ?? true,
    responseTimeInMs: 42,
    sslResponse: input.sslResponse,
    monitoredAt: new Date(),
  };
}

function observe(
  checkOn: CheckOn,
  dataToProcess: ProbeMonitorResponse,
): string | null {
  return MonitorCriteriaObservationBuilder.describeFilterObservation({
    monitor: new Monitor(),
    criteriaFilter: {
      checkOn: checkOn,
      filterType: FilterType.True,
      value: undefined,
    },
    dataToProcess: dataToProcess,
    monitorStep: new MonitorStep(),
  });
}

const VALID: SslMonitorResponse = {
  isValidCertificate: true,
  isSelfSigned: false,
  certificateValidationErrorCode: "",
  certificateValidationError: "",
  revocationStatus: CertificateRevocationStatus.NotRevoked,
  revocationCheckMethod: CertificateRevocationCheckMethod.Ocsp,
  expiresAt: dateFromNow(60),
};

// Not expired and not self-signed: the old inference called it valid.
const REVOKED: SslMonitorResponse = {
  isValidCertificate: false,
  isSelfSigned: false,
  certificateValidationErrorCode: "CERT_REVOKED",
  certificateValidationError: `certificate has been revoked by its issuer on ${REVOKED_AT_TEXT} (reason: Key Compromise)`,
  revocationStatus: CertificateRevocationStatus.Revoked,
  revocationCheckMethod: CertificateRevocationCheckMethod.Ocsp,
  revokedAt: new Date(REVOKED_AT),
  revocationReason: "Key Compromise",
  expiresAt: dateFromNow(60),
};

const HOSTNAME_MISMATCH: SslMonitorResponse = {
  isValidCertificate: false,
  isSelfSigned: false,
  certificateValidationErrorCode: "ERR_TLS_CERT_ALTNAME_INVALID",
  certificateValidationError:
    "Hostname/IP does not match certificate's altnames",
  expiresAt: dateFromNow(60),
};

const VALIDITY_CHECKS: Array<CheckOn> = [
  CheckOn.IsValidCertificate,
  CheckOn.IsNotAValidCertificate,
];

describe("the certificate validity observations", () => {
  describe.each(VALIDITY_CHECKS)("%s", (checkOn: CheckOn) => {
    test("a valid certificate is described as valid", () => {
      expect(observe(checkOn, probeResponse({ sslResponse: VALID }))).toBe(
        "SSL certificate is valid.",
      );
    });

    // The bug: described as valid while the monitor went offline.
    test("a revoked certificate that has not expired is described as not valid, with when and why", () => {
      expect(observe(checkOn, probeResponse({ sslResponse: REVOKED }))).toBe(
        `SSL certificate is not valid: certificate has been revoked by its issuer on ${REVOKED_AT_TEXT} (reason: Key Compromise)`,
      );
    });

    test("a certificate for another host name is described as not valid, with why", () => {
      expect(
        observe(checkOn, probeResponse({ sslResponse: HOSTNAME_MISMATCH })),
      ).toBe(
        "SSL certificate is not valid: Hostname/IP does not match certificate's altnames",
      );
    });

    // The old Is Not A Valid Certificate description called this one valid.
    test("an invalid certificate with no expiry date is described as not valid", () => {
      expect(
        observe(
          checkOn,
          probeResponse({
            sslResponse: {
              isValidCertificate: false,
              isSelfSigned: false,
              certificateValidationErrorCode: "UNABLE_TO_GET_ISSUER_CERT",
              certificateValidationError: "unable to get issuer certificate",
            },
          }),
        ),
      ).toBe("SSL certificate is not valid: unable to get issuer certificate");
    });

    test("an unreachable endpoint is described as the criteria give it", () => {
      expect(
        observe(
          checkOn,
          probeResponse({ isOnline: false, sslResponse: VALID }),
        ),
      ).toBe(
        "SSL certificate could not be checked because the endpoint is not reachable.",
      );
      expect(observe(checkOn, probeResponse({ isOnline: false }))).toBe(
        "SSL certificate could not be checked because the endpoint is not reachable.",
      );
    });

    test("an answer with no certificate details says so", () => {
      expect(observe(checkOn, probeResponse({}))).toBe(
        "SSL certificate details were unavailable.",
      );
    });

    /*
     * A response written before the probe recorded its verdict keeps the
     * old inference, as the criteria do.
     */
    test("a legacy response is judged by its expiry date and self-signed flag", () => {
      expect(
        observe(
          checkOn,
          probeResponse({
            sslResponse: { isSelfSigned: false, expiresAt: dateFromNow(30) },
          }),
        ),
      ).toBe("SSL certificate is valid.");

      expect(
        observe(
          checkOn,
          probeResponse({
            sslResponse: { isSelfSigned: false, expiresAt: dateFromNow(-1) },
          }),
        ),
      ).toBe("SSL certificate is not valid: the certificate has expired.");
    });
  });

  /*
   * The observation and the root cause are one judgement: whatever the
   * response, Is Not A Valid Certificate's root cause (when it matches) is
   * the sentence its observation gives, and Is Valid Certificate's
   * observation never says "valid" when its criteria found it not valid.
   */
  test.each([
    ["valid", VALID],
    ["revoked", REVOKED],
    ["hostname mismatch", HOSTNAME_MISMATCH],
    ["legacy expired", { isSelfSigned: false, expiresAt: dateFromNow(-1) }],
    ["legacy self-signed", { isSelfSigned: true, expiresAt: dateFromNow(30) }],
  ])(
    "%s: the observation agrees with the criteria",
    async (_name: string, sslResponse: SslMonitorResponse) => {
      const dataToProcess: ProbeMonitorResponse = probeResponse({
        sslResponse,
      });

      const notValidReason: string | null =
        await SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter: {
            checkOn: CheckOn.IsNotAValidCertificate,
            filterType: FilterType.True,
            value: undefined,
          },
        });

      const validReason: string | null =
        await SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter: {
            checkOn: CheckOn.IsValidCertificate,
            filterType: FilterType.True,
            value: undefined,
          },
        });

      const observed: string | null = observe(
        CheckOn.IsNotAValidCertificate,
        dataToProcess,
      );

      expect(observe(CheckOn.IsValidCertificate, dataToProcess)).toBe(observed);
      expect(observed).toBe(notValidReason ?? validReason);
    },
  );
});

describe("the Is Revoked Certificate observation", () => {
  test("a revoked certificate says when and why its issuer revoked it", () => {
    expect(
      observe(
        CheckOn.IsRevokedCertificate,
        probeResponse({ sslResponse: REVOKED }),
      ),
    ).toBe(
      `SSL certificate has been revoked by its issuer on ${REVOKED_AT_TEXT} (reason: Key Compromise).`,
    );
  });

  test("a certificate the issuer did not revoke says so", () => {
    expect(
      observe(
        CheckOn.IsRevokedCertificate,
        probeResponse({ sslResponse: VALID }),
      ),
    ).toBe("SSL certificate is not revoked.");
  });

  test("a status that could not be checked gives the probe's reason", () => {
    expect(
      observe(
        CheckOn.IsRevokedCertificate,
        probeResponse({
          sslResponse: {
            ...VALID,
            revocationStatus: CertificateRevocationStatus.Unknown,
            revocationCheckMethod: undefined,
            revocationCheckError:
              "The certificate names no OCSP responder and no CRL.",
          },
        }),
      ),
    ).toBe(
      "SSL certificate revocation status could not be checked: The certificate names no OCSP responder and no CRL.",
    );

    expect(
      observe(
        CheckOn.IsRevokedCertificate,
        probeResponse({
          sslResponse: {
            ...VALID,
            revocationStatus: CertificateRevocationStatus.Unknown,
            revocationCheckMethod: undefined,
          },
        }),
      ),
    ).toBe("SSL certificate revocation status could not be checked.");
  });

  /*
   * No status: the check did not run - the certificate failed validation
   * for another reason, the probe has it turned off, or it is older than
   * the check.
   */
  test("a response with no revocation status says it was unavailable", () => {
    expect(
      observe(
        CheckOn.IsRevokedCertificate,
        probeResponse({
          sslResponse: { ...HOSTNAME_MISMATCH, revocationStatus: undefined },
        }),
      ),
    ).toBe("SSL certificate revocation status was unavailable.");

    expect(observe(CheckOn.IsRevokedCertificate, probeResponse({}))).toBe(
      "SSL certificate revocation status was unavailable.",
    );
  });
});
