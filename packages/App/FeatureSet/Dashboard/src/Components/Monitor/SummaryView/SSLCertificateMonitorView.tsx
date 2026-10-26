import OneUptimeDate from "Common/Types/Date";
import SslMonitorResponse from "Common/Types/Monitor/SSLMonitor/SslMonitorResponse";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import ProbeAttemptsView from "./ProbeAttemptsView";
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

interface CertificateSummaryProps extends ComponentProps {
  sslResponse: SslMonitorResponse;
}

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
            value={sslResponse.certificateValidationError}
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
       * row of its own and whole, where they were cut short with an ellipsis.
       */}
      {showMoreDetails && (
        <SummaryFacts dataTestId="ssl-certificate-details">
          <SummaryFact
            title="Common Name"
            value={sslResponse.commonName || "-"}
          />
          <SummaryFact
            title="Organization"
            value={sslResponse.organization || "-"}
          />
          <SummaryFact
            title="Organizational Unit"
            value={sslResponse.organizationalUnit || "-"}
          />
          <SummaryFact title="Country" value={sslResponse.country || "-"} />
          <SummaryFact title="State" value={sslResponse.state || "-"} />
          <SummaryFact title="Locality" value={sslResponse.locality || "-"} />
          {/* Without this the product could not name the signing CA. */}
          <SummaryFact
            isWide={true}
            title="Issuer"
            value={sslResponse.issuer || "-"}
          />
          <SummaryFact
            isWide={true}
            title="Serial Number"
            value={sslResponse.serialNumber || "-"}
          />
          <SummaryFact
            isWide={true}
            title="Fingerprint"
            value={sslResponse.fingerprint || "-"}
          />
          <SummaryFact
            isWide={true}
            title="Fingerprint 256"
            value={sslResponse.fingerprint256 || "-"}
          />
        </SummaryFacts>
      )}

      {!showMoreDetails && (
        <div className="-ml-2">
          <Button
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            title="Show More Details"
            onClick={() => {
              return setShowMoreDetails(true);
            }}
          />
        </div>
      )}

      {showMoreDetails && (
        <div className="-ml-2">
          <Button
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            title="Hide Details"
            onClick={() => {
              return setShowMoreDetails(false);
            }}
          />
        </div>
      )}
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
