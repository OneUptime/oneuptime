import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import Hostname from "../../../Types/API/Hostname";
import CustomCodeMonitorResponse from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import CertificateRevocationCheckMethod from "../../../Types/Monitor/SSLMonitor/CertificateRevocationCheckMethod";
import CertificateRevocationStatus from "../../../Types/Monitor/SSLMonitor/CertificateRevocationStatus";
import SslMonitorResponse from "../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import CustomMonitorSummaryView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/CustomMonitorSummaryView";
import SSLCertificateMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SSLCertificateMonitorView";

/*
 * A monitor summary stays mounted while the probe result under it changes:
 * a newer check, another probe picked. When a result arrives without the
 * part a summary shows, the summary says so ("No summary available...") and
 * draws the result again when it is back.
 *
 * Both summaries checked for that part below a hook of their own: the custom
 * script summary below #4295's translation hook as well, so a result going
 * missing changed how many hooks it called and React threw "Rendered fewer
 * hooks than expected". The certificate summary called no hook above its
 * check, so it only dropped its state - and would have thrown the same way
 * as soon as one was added. Each now checks in a wrapper with no hooks.
 *
 * i18next is set up the way the Dashboard sets it up. Without an instance,
 * useTranslation() returns before calling any hook of its own, and React
 * cannot notice a hook count that changes from zero, so the crash only shows
 * with translations switched on.
 */

const MONITORED_AT: Date = new Date("2026-08-07T12:30:00.000Z");

const NO_SUMMARY: RegExp = /^No summary available for the selected probe/;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: false,
    resources: {
      de: {
        translation: {
          No: "Nein",
          // The certificate summary's revocation facts, as de.json words them.
          "Revocation Status": "Widerrufsstatus",
          Revoked: "Widerrufen",
          "Not Revoked": "Nicht widerrufen",
          "Could Not Be Checked": "Konnte nicht geprüft werden",
          "Revocation Checked With": "Widerruf geprüft über",
          "Revocation Check Problem": "Problem bei der Widerrufsprüfung",
        },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("CustomMonitorSummaryView", () => {
  const RUN: CustomCodeMonitorResponse = {
    result: { orders: 12 },
    logMessages: [],
    capturedMetrics: [],
    executionTimeInMS: 41.6,
  };

  function summary(
    response: CustomCodeMonitorResponse | undefined,
  ): ReactElement {
    return (
      <CustomMonitorSummaryView
        customCodeMonitorResponse={response as CustomCodeMonitorResponse}
        monitoredAt={MONITORED_AT}
        probeName="London Probe"
      />
    );
  }

  test("a run that goes missing and comes back is summarised again", () => {
    const { rerender } = render(summary(RUN));
    expect(screen.getByText("42 ms")).toBeInTheDocument();
    // The Error card, in the reader's language.
    expect(screen.getByText("Nein")).toBeInTheDocument();

    rerender(summary(undefined));
    expect(screen.getByText(NO_SUMMARY)).toBeInTheDocument();
    expect(screen.queryByText("42 ms")).not.toBeInTheDocument();

    rerender(summary(RUN));
    expect(screen.getByText("42 ms")).toBeInTheDocument();
    expect(screen.queryByText(NO_SUMMARY)).not.toBeInTheDocument();
  });
});

describe("SSLCertificateMonitorView", () => {
  function probeResponse(
    overrides: Partial<ProbeMonitorResponse> = {},
  ): ProbeMonitorResponse {
    return {
      projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
      monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
      probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
      monitorDestination: new Hostname("shop.example.com"),
      isOnline: true,
      failureCause: "",
      monitoredAt: MONITORED_AT,
      ...overrides,
    };
  }

  const WITH_CERTIFICATE: ProbeMonitorResponse = probeResponse({
    sslResponse: {
      isValidCertificate: true,
      isSelfSigned: false,
      commonName: "shop.example.com",
      organization: "Example Shop",
    },
  });

  const WITHOUT_CERTIFICATE: ProbeMonitorResponse = probeResponse({
    isOnline: false,
    failureCause: "Connection refused",
  });

  function summary(response: ProbeMonitorResponse): ReactElement {
    return (
      <SSLCertificateMonitorView
        probeMonitorResponse={response}
        probeName="London Probe"
      />
    );
  }

  test("a certificate that goes missing and comes back is summarised again", () => {
    const { rerender } = render(summary(WITH_CERTIFICATE));
    expect(screen.getByText("shop.example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show More Details" }));
    expect(screen.getByText("Example Shop")).toBeInTheDocument();

    rerender(summary(WITHOUT_CERTIFICATE));
    expect(screen.getByText(NO_SUMMARY)).toBeInTheDocument();
    expect(screen.queryByText("Example Shop")).not.toBeInTheDocument();

    // Drawn afresh, as before: the details start folded again.
    rerender(summary(WITH_CERTIFICATE));
    expect(screen.queryByText(NO_SUMMARY)).not.toBeInTheDocument();
    expect(screen.queryByText("Example Shop")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show More Details" }));
    expect(screen.getByText("Example Shop")).toBeInTheDocument();
  });

  /*
   * Whether the issuer has revoked the certificate: a fact of the summary
   * once the probe checked, in the reader's language, with how it was
   * checked - or why it could not be - under Show More Details.
   */
  describe("revocation", () => {
    function withRevocation(
      revocation: Partial<SslMonitorResponse>,
    ): ProbeMonitorResponse {
      return probeResponse({
        sslResponse: {
          isValidCertificate: true,
          isSelfSigned: false,
          commonName: "shop.example.com",
          ...revocation,
        },
      });
    }

    test("a certificate the issuer did not revoke says so, and how it was checked", () => {
      render(
        summary(
          withRevocation({
            revocationStatus: CertificateRevocationStatus.NotRevoked,
            revocationCheckMethod: CertificateRevocationCheckMethod.StapledOcsp,
          }),
        ),
      );

      expect(screen.getByText("Widerrufsstatus")).toBeInTheDocument();
      expect(screen.getByText("Nicht widerrufen")).toBeInTheDocument();
      expect(screen.queryByText("Stapled OCSP")).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Show More Details" }),
      );

      // The method is the probe's own English name, shown as it is.
      expect(screen.getByText("Widerruf geprüft über")).toBeInTheDocument();
      expect(screen.getByText("Stapled OCSP")).toBeInTheDocument();
      expect(
        screen.queryByText("Problem bei der Widerrufsprüfung"),
      ).not.toBeInTheDocument();
    });

    test("a revoked certificate says it was revoked", () => {
      render(
        summary(
          withRevocation({
            isValidCertificate: false,
            certificateValidationErrorCode: "CERT_REVOKED",
            certificateValidationError:
              "certificate has been revoked by its issuer (reason: Key Compromise)",
            revocationStatus: CertificateRevocationStatus.Revoked,
            revocationCheckMethod: CertificateRevocationCheckMethod.Ocsp,
          }),
        ),
      );

      expect(screen.getByText("Widerrufsstatus")).toBeInTheDocument();
      expect(screen.getByText("Widerrufen")).toBeInTheDocument();
    });

    test("a status that could not be checked says why under Show More Details", () => {
      render(
        summary(
          withRevocation({
            revocationStatus: CertificateRevocationStatus.Unknown,
            revocationCheckError:
              "No OCSP responder or CRL answered within 5 seconds",
          }),
        ),
      );

      expect(
        screen.getByText("Konnte nicht geprüft werden"),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Show More Details" }),
      );

      expect(
        screen.getByText("Problem bei der Widerrufsprüfung"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("No OCSP responder or CRL answered within 5 seconds"),
      ).toBeInTheDocument();
      // No answer, so no method to name.
      expect(
        screen.queryByText("Widerruf geprüft über"),
      ).not.toBeInTheDocument();
    });

    /*
     * The check did not run: the certificate failed validation for another
     * reason, the probe has it turned off, or it is older than the check.
     */
    test("a certificate whose revocation was not checked shows no revocation fact", () => {
      render(summary(withRevocation({})));

      expect(screen.queryByText("Widerrufsstatus")).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Show More Details" }),
      );

      expect(
        screen.queryByText("Widerruf geprüft über"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Problem bei der Widerrufsprüfung"),
      ).not.toBeInTheDocument();
    });
  });
});
