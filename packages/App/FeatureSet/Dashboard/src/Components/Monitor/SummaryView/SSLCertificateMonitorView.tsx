import OneUptimeDate from "Common/Types/Date";
import SslMonitorResponse from "Common/Types/Monitor/SSLMonitor/SslMonitorResponse";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";
import ProbeAttemptsView from "./ProbeAttemptsView";

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
    return "Valid";
  }

  if (isValid === false) {
    if (sslResponse.isSelfSigned) {
      return "Not Valid - Self Signed";
    }

    return sslResponse.certificateValidationErrorCode
      ? `Not Valid - ${sslResponse.certificateValidationErrorCode}`
      : "Not Valid";
  }

  return sslResponse.isSelfSigned ? "Self Signed" : "Signed by a CA";
}

const SSLCertificateMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.probeMonitorResponse || !props.probeMonitorResponse.sslResponse) {
    return (
      <ErrorMessage message="No summary available for the selected probe. Should be few minutes for summary to show up. " />
    );
  }

  const sslResponse: SslMonitorResponse =
    props.probeMonitorResponse.sslResponse;

  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100 "
            title="URL"
            value={
              props.probeMonitorResponse.monitorDestination?.toString() || "-"
            }
          />
        </div>
        <div className="flex space-x-3 w-full">
          <InfoCard
            className="w-1/4 shadow-none border-2 border-gray-100 "
            title="Probe"
            value={props.probeName || "-"}
          />
          {/*
           * Reports the VALIDATION verdict, not just how the certificate was
           * signed. "Signed by a CA" was shown for any certificate that was
           * not self-signed, so an expired or wrong-hostname certificate read
           * as reassuring - see issue #3225.
           */}
          <InfoCard
            className="w-1/4 shadow-none border-2 border-gray-100 "
            title="SSL Status"
            value={sslStatusLabel(sslResponse)}
          />

          <InfoCard
            className="w-1/4 shadow-none border-2 border-gray-100 "
            title="Issued At"
            value={
              sslResponse.createdAt
                ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    sslResponse.createdAt,
                  )
                : "-"
            }
          />

          <InfoCard
            className="w-1/4 shadow-none border-2 border-gray-100 "
            title="Expires At"
            value={
              sslResponse.expiresAt
                ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    sslResponse.expiresAt,
                  )
                : "-"
            }
          />
        </div>

        {/*
         * The reason a certificate failed validation is the single most
         * useful thing on this page when something is wrong, so it is shown
         * without needing to expand details.
         */}
        {sslResponse.certificateValidationError ? (
          <div className="flex space-x-3 w-full">
            <InfoCard
              className="w-full shadow-none border-2 border-gray-100 "
              title="Certificate Problem"
              value={sslResponse.certificateValidationError}
            />
          </div>
        ) : (
          <></>
        )}

        {showMoreDetails && hadRetries && (
          <ProbeAttemptsView
            attempts={probeAttempts}
            totalAttempts={totalAttempts}
          />
        )}

        {showMoreDetails && (
          <div className="space-y-5">
            <div className="flex space-x-3 w-full">
              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title="Common Name"
                value={sslResponse.commonName || "-"}
              />

              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title="Organizational Unit"
                value={sslResponse.organizationalUnit || "-"}
              />

              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title="Organization"
                value={sslResponse.organization || "-"}
              />
            </div>
            <div className="flex space-x-3 w-full">
              {/* Without this the product could not name the signing CA. */}
              <InfoCard
                className="w-full shadow-none border-2 border-gray-100 "
                title="Issuer"
                value={sslResponse.issuer || "-"}
                textClassName="text-xs truncate"
              />
            </div>
            <div className="flex space-x-3 w-full">
              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title="Locality"
                value={sslResponse.locality || "-"}
              />

              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title="State"
                value={sslResponse.state || "-"}
              />

              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title="Country"
                value={sslResponse.country || "-"}
              />
            </div>
            <div className="flex space-x-3 w-full">
              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title="Serial Number"
                value={sslResponse.serialNumber || "-"}
                textClassName="text-xs truncate"
              />

              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title="Fingerprint"
                value={sslResponse.fingerprint || "-"}
                textClassName="text-xs truncate"
              />

              <InfoCard
                className="w-1/3 shadow-none border-2 border-gray-100 "
                title="Fingerprint 256"
                value={sslResponse.fingerprint256 || "-"}
                textClassName="text-xs truncate"
              />
            </div>
          </div>
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

        {/* Hide details button */}

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
      </div>
    </div>
  );
};

export default SSLCertificateMonitorView;
