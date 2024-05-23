import OneUptimeDate from 'Common/Types/Date';
import SslMonitorResponse from 'Common/Types/Monitor/SSLMonitor/SslMonitorResponse';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import InfoCard from 'CommonUI/src/Components/InfoCard/InfoCard';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    probeMonitorResponse: ProbeMonitorResponse;
}

const SSLCertificateMonitorView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (
        !props.probeMonitorResponse ||
        !props.probeMonitorResponse.sslResponse
    ) {
        return (
            <ErrorMessage error="No metrics available for the selected probe. This could be because the probe has not yet started monitoring." />
        );
    }

    const sslResponse: SslMonitorResponse =
        props.probeMonitorResponse.sslResponse;

    const [showMoreDetails, setShowMoreDetails] =
        React.useState<boolean>(false);

    return (
        <div className="space-y-5">
            <div className="flex space-x-3">
                <InfoCard
                    className="w-1/3 shadow-none border-2 border-gray-100 "
                    title="SSL Status"
                    value={
                        sslResponse.isSelfSigned
                            ? 'Self Signed'
                            : 'Signed by a CA'
                    }
                />

                <InfoCard
                    className="w-1/3 shadow-none border-2 border-gray-100 "
                    title="Issued At"
                    value={
                        sslResponse.createdAt
                            ? OneUptimeDate.getDateAsLocalFormattedString(
                                  sslResponse.createdAt
                              )
                            : '-'
                    }
                />

                <InfoCard
                    className="w-1/3 shadow-none border-2 border-gray-100 "
                    title="Expires At"
                    value={
                        sslResponse.expiresAt
                            ? OneUptimeDate.getDateAsLocalFormattedString(
                                  sslResponse.expiresAt
                              )
                            : '-'
                    }
                />

                {showMoreDetails && (
                    <>
                        <InfoCard
                            className="w-1/3 shadow-none border-2 border-gray-100 "
                            title="Common Name"
                            value={sslResponse.commonName || '-'}
                        />

                        <InfoCard
                            className="w-1/3 shadow-none border-2 border-gray-100 "
                            title="Organizational Unit"
                            value={sslResponse.organizationalUnit || '-'}
                        />

                        <InfoCard
                            className="w-1/3 shadow-none border-2 border-gray-100 "
                            title="Organization"
                            value={sslResponse.organization || '-'}
                        />

                        <InfoCard
                            className="w-1/3 shadow-none border-2 border-gray-100 "
                            title="Locality"
                            value={sslResponse.locality || '-'}
                        />

                        <InfoCard
                            className="w-1/3 shadow-none border-2 border-gray-100 "
                            title="State"
                            value={sslResponse.state || '-'}
                        />

                        <InfoCard
                            className="w-1/3 shadow-none border-2 border-gray-100 "
                            title="Country"
                            value={sslResponse.country || '-'}
                        />

                        <InfoCard
                            className="w-1/3 shadow-none border-2 border-gray-100 "
                            title="Serial Number"
                            value={sslResponse.serialNumber || '-'}
                        />

                        <InfoCard
                            className="w-1/3 shadow-none border-2 border-gray-100 "
                            title="Fingerprint"
                            value={sslResponse.fingerprint || '-'}
                        />

                        <InfoCard
                            className="w-1/3 shadow-none border-2 border-gray-100 "
                            title="Fingerprint 256"
                            value={sslResponse.fingerprint256 || '-'}
                        />
                    </>
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
