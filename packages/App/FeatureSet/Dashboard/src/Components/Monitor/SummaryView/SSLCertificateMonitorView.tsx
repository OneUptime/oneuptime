import OneUptimeDate from "Common/Types/Date";
import CertificateRevocationStatus from "Common/Types/Monitor/SSLMonitor/CertificateRevocationStatus";
import SslMonitorResponse from "Common/Types/Monitor/SSLMonitor/SslMonitorResponse";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import ProbeAttemptsView from "./ProbeAttemptsView";
import ProbeMessageLine from "./ProbeMessageLine";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

/*
 * Describes the certificate in one line: whether it is trustworthy, and if
 * not, why. isValidCertificate is absent on responses written by an older
 * probe, in which case fall back to what could be inferred before.
 */
export function sslStatusLabel(sslResponse: SslMonitorResponse): string {
  const isValid: boolean | undefined = sslResponse.isValidCertificate;

  if (isValid === true) {
    return translateTemplate("Valid");
  }

  if (isValid === false) {
    if (sslResponse.isSelfSigned) {
      return translateTemplate("Not Valid - Self Signed");
    }

    // The error code is the TLS library's own identifier, kept as it is.
    return sslResponse.certificateValidationErrorCode
      ? translateTemplate("Not Valid - {{code}}", {
          code: sslResponse.certificateValidationErrorCode,
        })
      : translateTemplate("Not Valid");
  }

  return sslResponse.isSelfSigned
    ? translateTemplate("Self Signed")
    : translateTemplate("Signed by a CA");
}

/*
 * Whether the certificate's issuer has revoked it, as the probe found out
 * from the issuer's signed OCSP response or CRL. Null when no check ran -
 * the certificate failed validation for another reason, the probe has the
 * check turned off, or it is older than the check - so nothing is shown.
 */
export function revocationStatusLabel(
  sslResponse: SslMonitorResponse,
): string | null {
  switch (sslResponse.revocationStatus) {
    case CertificateRevocationStatus.NotRevoked:
      return translateTemplate("Not Revoked");
    case CertificateRevocationStatus.Revoked:
      return translateTemplate("Revoked");
    // No signed answer could be had; like a browser, not taken as revoked.
    case CertificateRevocationStatus.Unknown:
      return translateTemplate("Could Not Be Checked");
    default:
      return null;
  }
}

interface CertificateSummaryProps extends ComponentProps {
  sslResponse: SslMonitorResponse;
}

// A detail's words; stored responses are read as they were written.
const textOf: (value: unknown) => string = (value: unknown): string => {
  return value === undefined || value === null ? "" : String(value).trim();
};

// One line of what a certificate says about itself.
interface CertificateDetail {
  // English; looked up when drawn.
  title: string;
  value: string;
  isWide: boolean;
  /*
   * The probe's own message (the TLS library's, an issuer's server's), in
   * English: drawn in a line of its own direction (ProbeMessageLine).
   */
  isProbeMessage: boolean;
}

/*
 * Why the check failed, when that is not the certificate's problem shown
 * above it: the connection was refused or timed out (the probe's timeout
 * sentence, read in the reader's language), or no certificate came back.
 * A certificate that failed validation stores its problem as the failure
 * cause too, and that is said once, as the Certificate Problem.
 */
export const getSslCheckError: (data: {
  failureCause: string | undefined;
  certificateValidationError: string | undefined;
}) => string = (data: {
  failureCause: string | undefined;
  certificateValidationError: string | undefined;
}): string => {
  const failureCause: string = textOf(data.failureCause);

  return failureCause === textOf(data.certificateValidationError)
    ? ""
    : failureCause;
};

// Drawn by SSLCertificateMonitorView once there is a certificate to show.
const CertificateSummary: FunctionComponent<CertificateSummaryProps> = (
  props: CertificateSummaryProps,
): ReactElement => {
  const sslResponse: SslMonitorResponse = props.sslResponse;

  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  const revocationStatus: string | null = revocationStatusLabel(sslResponse);

  /*
   * What the certificate says, and how its revocation was checked (Show
   * More Details).
   */
  const certificateDetails: Array<CertificateDetail> = [
    { title: translationKey("Common Name"), value: sslResponse.commonName },
    { title: translationKey("Organization"), value: sslResponse.organization },
    {
      title: translationKey("Organizational Unit"),
      value: sslResponse.organizationalUnit,
    },
    { title: translationKey("Country"), value: sslResponse.country },
    { title: translationKey("State"), value: sslResponse.state },
    { title: translationKey("Locality"), value: sslResponse.locality },
    // Without this the product could not name the signing CA.
    {
      title: translationKey("Issuer"),
      value: sslResponse.issuer,
      isWide: true,
    },
    {
      title: translationKey("Serial Number"),
      value: sslResponse.serialNumber,
      isWide: true,
    },
    {
      title: translationKey("Fingerprint"),
      value: sslResponse.fingerprint,
      isWide: true,
    },
    {
      title: translationKey("Fingerprint 256"),
      value: sslResponse.fingerprint256,
      isWide: true,
    },
    // Where the issuer's answer came from: "Stapled OCSP", "OCSP" or "CRL".
    {
      title: translationKey("Revocation Checked With"),
      value: sslResponse.revocationCheckMethod,
    },
    // Why no signed answer could be had, as the probe says it.
    {
      title: translationKey("Revocation Check Problem"),
      value:
        sslResponse.revocationStatus === CertificateRevocationStatus.Unknown
          ? sslResponse.revocationCheckError
          : undefined,
      isWide: true,
      isProbeMessage: true,
    },
  ]
    .filter(
      (detail: {
        title: string;
        value: string | undefined;
        isWide?: boolean;
        isProbeMessage?: boolean;
      }): boolean => {
        return textOf(detail.value) !== "";
      },
    )
    .map(
      (detail: {
        title: string;
        value: string | undefined;
        isWide?: boolean;
        isProbeMessage?: boolean;
      }): CertificateDetail => {
        return {
          title: detail.title,
          value: textOf(detail.value),
          isWide: Boolean(detail.isWide),
          isProbeMessage: Boolean(detail.isProbeMessage),
        };
      },
    );

  const checkError: string = getSslCheckError({
    failureCause: props.probeMonitorResponse.failureCause?.toString(),
    certificateValidationError: sslResponse.certificateValidationError,
  });

  return (
    <SummaryView dataTestId="ssl-certificate-monitor-summary">
      <SummaryFacts>
        <SummaryFact
          isWide={true}
          title="URL"
          value={
            props.probeMonitorResponse.monitorDestination?.toString() || "-"
          }
        />
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        {/*
         * Reports the VALIDATION verdict, not just how the certificate was
         * signed. "Signed by a CA" was shown for any certificate that was
         * not self-signed, so an expired or wrong-hostname certificate read
         * as reassuring - see issue #3225.
         */}
        <SummaryFact title="SSL Status" value={sslStatusLabel(sslResponse)} />
        {/*
         * Whether the issuer has revoked the certificate - what a browser
         * asks and the TLS library alone never does. Shown only when the
         * probe checked.
         */}
        {revocationStatus ? (
          <SummaryFact title="Revocation Status" value={revocationStatus} />
        ) : (
          <></>
        )}
        <SummaryFact
          title="Issued At"
          value={
            sslResponse.createdAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  sslResponse.createdAt,
                )
              : "-"
          }
        />
        <SummaryFact
          title="Expires At"
          value={
            sslResponse.expiresAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  sslResponse.expiresAt,
                )
              : "-"
          }
        />
        {/*
         * The reason a certificate failed validation is the single most
         * useful thing on this page when something is wrong, so it is shown
         * without needing to expand details.
         */}
        {sslResponse.certificateValidationError ? (
          <SummaryFact
            isWide={true}
            title="Certificate Problem"
            value={
              <ProbeMessageLine
                message={sslResponse.certificateValidationError}
              />
            }
          />
        ) : (
          <></>
        )}
        {/*
         * A check that never reached a certificate - refused, timed out -
         * says why, as every other check's summary does.
         */}
        {checkError ? (
          <SummaryFact
            isWide={true}
            title="Error"
            value={<ProbeMessageLine message={checkError} />}
          />
        ) : (
          <></>
        )}
      </SummaryFacts>

      {showMoreDetails && hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}

      {/*
       * Who the certificate is for and who signed it, then the long values
       * - the issuer, the serial number and the fingerprints - each on a
       * row of its own and whole, where they were cut short with an
       * ellipsis. What the certificate does not say is left out, rather
       * than a card of "-" for each.
       */}
      {showMoreDetails && certificateDetails.length > 0 && (
        <SummaryFacts dataTestId="ssl-certificate-details">
          {certificateDetails.map((detail: CertificateDetail): ReactElement => {
            return (
              <SummaryFact
                key={detail.title}
                isWide={detail.isWide}
                title={detail.title}
                value={
                  detail.isProbeMessage ? (
                    <ProbeMessageLine message={detail.value} />
                  ) : (
                    detail.value
                  )
                }
              />
            );
          })}
        </SummaryFacts>
      )}

      {/*
       * One button, open or folded: its words follow the state and it
       * keeps its place, so focus stays on it after a press.
       */}
      <div className="-ml-3">
        <Button
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          title={showMoreDetails ? "Hide Details" : "Show More Details"}
          ariaExpanded={showMoreDetails}
          onClick={() => {
            return setShowMoreDetails(!showMoreDetails);
          }}
        />
      </div>
    </SummaryView>
  );
};

/*
 * Whether there is a certificate to show calls no hook, so it is decided here
 * and the "Show More Details" state lives in CertificateSummary: a probe
 * whose certificate goes missing, or comes back, unmounts or mounts the
 * summary. While that state sat below this check, the component called its
 * hook on some renders and not on others: React dropped the state each time
 * the certificate went missing, and would have thrown "Rendered more hooks
 * than during the previous render" as soon as any hook ran above the check.
 */
const SSLCertificateMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.probeMonitorResponse || !props.probeMonitorResponse.sslResponse) {
    return (
      <ErrorMessage message="No summary available for the selected probe. Should be few minutes for summary to show up. " />
    );
  }

  return (
    <CertificateSummary
      {...props}
      sslResponse={props.probeMonitorResponse.sslResponse}
    />
  );
};

export default SSLCertificateMonitorView;
