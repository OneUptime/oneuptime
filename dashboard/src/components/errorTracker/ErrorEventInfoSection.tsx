import React from 'react';
import PropTypes from 'prop-types';

export interface ComponentProps {
    title?: string;
    value?: string;
}

function RenderTagContent({
    title,
    value
}: RenderTagContentProps) {
    return (
        <div className="Flex-flex Margin-vertical--4 ">
            <span
                className="Flex-flex Flex-alignItems--center"
                style={{ width: '25%' }}
            >
                {title}
            </span>
            <span
                style={{
                    backgroundColor: '#F7F8F9',
                    padding: '15px',
                    width: '75%',
                }}
            >
                {value}
            </span>
        </div>
    );
}
RenderTagContent.propTypes = {
    title: PropTypes.string,
    value: PropTypes.string,
};
RenderTagContent.displayName = 'RenderTagContent';

interface ErrorEventInfoSectionProps {
    errorEvent?: object;
}

function ErrorEventInfoSection({
    errorEvent
}: ErrorEventInfoSectionProps) {
    const errorEventDetails = errorEvent.errorEvent;
    return (
        <div>
            {errorEventDetails &&
                errorEventDetails.device &&
                errorEventDetails.device.browser ? (
                <div className="ContentHeader Box-root Box-background--white Box-divider--border-top-1 Flex-flex Flex-direction--column Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Browser</span>
                            </span>
                        </div>
                    </div>
                    <div className="Margin-vertical--8">
                        <RenderTagContent
                            title="Brand"
                            value={errorEventDetails.device.browser.name}
                        />
                        <RenderTagContent
                            title="Version"
                            value={errorEventDetails.device.browser.version}
                        />
                    </div>
                </div>
            ) : null}

            {errorEventDetails &&
                errorEventDetails.device &&
                errorEventDetails.device.device ? (
                <div className="ContentHeader Box-root Box-background--white Box-divider--border-top-1 Flex-flex Flex-direction--column Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Operating System</span>
                            </span>
                        </div>
                    </div>
                    <div className="Margin-vertical--8">
                        <RenderTagContent
                            title="Device"
                            value={errorEventDetails.device.device.join(' ')}
                        />
                    </div>
                </div>
            ) : null}

            {!errorEvent.requesting &&
                errorEventDetails &&
                errorEventDetails.sdk ? (
                <div className="ContentHeader Box-root Box-background--white Box-divider--border-top-1 Flex-flex Flex-direction--column Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>SDK</span>
                            </span>
                        </div>
                    </div>
                    <div className="Margin-vertical--8">
                        <RenderTagContent
                            title="Name"
                            value={errorEventDetails.sdk.name}
                        />
                        <RenderTagContent
                            title="Version"
                            value={errorEventDetails.sdk.version}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );
}
ErrorEventInfoSection.propTypes = {
    errorEvent: PropTypes.object,
};
ErrorEventInfoSection.displayName = 'ErrorEventInfoSection';
export default ErrorEventInfoSection;
