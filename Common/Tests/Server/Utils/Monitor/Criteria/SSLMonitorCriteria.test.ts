import SSLMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SSLMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
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

      expect(result).toBe("SSL certificate is not valid.");
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

      expect(result).toBe("SSL certificate is not valid.");
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

      expect(result).toBe("SSL certificate is not valid.");
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

      expect(result).toBe("SSL certificate is not valid.");
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
   * A probe that could not reach the host at all still ships an sslResponse -
   * the probe fills it from the offline result object - so it is truthy but
   * carries no certificate. IsSelfSignedCertificate and IsExpiredCertificate
   * used to answer "not self signed" / "not expired" from that, which turned an
   * outage into a green check for anyone using either in their Operational
   * criteria. Both now gate on reachability the way IsValidCertificate always
   * has.
   */
  describe("an unreachable host cannot produce a green certificate check", () => {
    const offlineWithEmptySslResponse: () => ProbeMonitorResponse = () => {
      return buildDataToProcess({
        isOnline: false,
        sslResponse: {},
      });
    };

    test("IsSelfSignedCertificate + False → indeterminate, not met", async () => {
      const result: string | null = await evaluate(
        offlineWithEmptySslResponse(),
        {
          checkOn: CheckOn.IsSelfSignedCertificate,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("IsSelfSignedCertificate + True → indeterminate", async () => {
      const result: string | null = await evaluate(
        offlineWithEmptySslResponse(),
        {
          checkOn: CheckOn.IsSelfSignedCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("IsExpiredCertificate + False → indeterminate, not met", async () => {
      const result: string | null = await evaluate(
        offlineWithEmptySslResponse(),
        {
          checkOn: CheckOn.IsExpiredCertificate,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("IsExpiredCertificate + True → indeterminate", async () => {
      const result: string | null = await evaluate(
        offlineWithEmptySslResponse(),
        {
          checkOn: CheckOn.IsExpiredCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("no sslResponse at all + False → indeterminate", async () => {
      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        isOnline: false,
        includeSslResponse: false,
      });

      await expect(
        evaluate(dataToProcess, {
          checkOn: CheckOn.IsSelfSignedCertificate,
          filterType: FilterType.False,
          value: undefined,
        }),
      ).resolves.toBeNull();

      await expect(
        evaluate(dataToProcess, {
          checkOn: CheckOn.IsExpiredCertificate,
          filterType: FilterType.False,
          value: undefined,
        }),
      ).resolves.toBeNull();
    });

    /*
     * The reachability checks still answer - they are the ones that are
     * supposed to notice a dead host.
     */
    test("IsOnline + False still reports the host as down", async () => {
      const result: string | null = await evaluate(
        offlineWithEmptySslResponse(),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeTruthy();
    });

    test("IsNotAValidCertificate + True still fires", async () => {
      const result: string | null = await evaluate(
        offlineWithEmptySslResponse(),
        {
          checkOn: CheckOn.IsNotAValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBe("SSL certificate is not valid.");
    });
  });

  /*
   * Issue #3225. The reporter's monitor pointed at self-signed.badssl.com,
   * which the probe reports as reachable (a certificate was obtained) but
   * untrusted. Their two criteria were "Is Valid Certificate = True" for
   * Operational and "Is Online = False" for Down - and NEITHER can match that
   * response. A criteria set where nothing matches is completely silent: the
   * monitor stays parked at its default status with no timeline event and no
   * incident, which reads in the dashboard exactly like a monitor that never
   * ran at all.
   */
  describe("issue #3225 - a self-signed host under the reporter's criteria", () => {
    const selfSignedButReachable: () => ProbeMonitorResponse = () => {
      return buildDataToProcess({
        isOnline: true,
        sslResponse: {
          isSelfSigned: true,
          expiresAt: dateFromNow({ days: 365 }),
        },
      });
    };

    test("IsValidCertificate = True does not match", async () => {
      const result: string | null = await evaluate(selfSignedButReachable(), {
        checkOn: CheckOn.IsValidCertificate,
        filterType: FilterType.True,
        value: undefined,
      });

      expect(result).toBeNull();
    });

    test("IsOnline = False does not match", async () => {
      const result: string | null = await evaluate(selfSignedButReachable(), {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      });

      expect(result).toBeNull();
    });

    /*
     * The criteria the product ships by default DOES catch this host, which is
     * why the stock configuration was never affected. Pinning it makes sure the
     * default keeps working.
     */
    test("the shipped default offline criteria (IsNotAValidCertificate = True) does match", async () => {
      const result: string | null = await evaluate(selfSignedButReachable(), {
        checkOn: CheckOn.IsNotAValidCertificate,
        filterType: FilterType.True,
        value: undefined,
      });

      expect(result).toBe("SSL certificate is not valid.");
    });

    test("IsSelfSignedCertificate = True also catches it", async () => {
      const result: string | null = await evaluate(selfSignedButReachable(), {
        checkOn: CheckOn.IsSelfSignedCertificate,
        filterType: FilterType.True,
        value: undefined,
      });

      expect(result).toBe("SSL Certificate is self signed.");
    });
  });

  /*
   * A handshake that never completed is not a reachable endpoint. The probe
   * used to report isOnline: true alongside isTimeout: true on that path, which
   * would have kept an "Is Online = True" criteria matching forever against a
   * host that had stopped answering.
   */
  describe("a timed-out check", () => {
    test("is reported as offline and timed out", async () => {
      const timedOut: ProbeMonitorResponse = buildDataToProcess({
        isOnline: false,
        isTimeout: true,
        sslResponse: {},
      });

      await expect(
        evaluate(timedOut, {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        }),
      ).resolves.toBeTruthy();

      await expect(
        evaluate(timedOut, {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        }),
      ).resolves.toBeTruthy();

      await expect(
        evaluate(timedOut, {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        }),
      ).resolves.toBeNull();
    });
  });
});
