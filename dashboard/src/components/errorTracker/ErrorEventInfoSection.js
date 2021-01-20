import React from 'react';
import PropTypes from 'prop-types';

function RenderTagContent({ title, value }) {
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
function ErrorEventInfoSection({ errorEvent }) {
    const errorEventDetails = errorEvent.errorEvent;
    return (
        <div>
            {errorEventDetails &&
            errorEventDetails.device &&
            errorEventDetails.device.browser ? (
                <div className="Box-divider--border-top-1 Padding-vertical--20">
                    <div className="Flex-flex Flex-justifyContent--spaceBetween">
                        <p className="SubHeader">Browser</p>
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
                <div className="Box-divider--border-top-1 Padding-vertical--20">
                    <div className="Flex-flex Flex-justifyContent--spaceBetween">
                        <p className="SubHeader">Operating System</p>
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
                <div className="Box-divider--border-top-1 Padding-vertical--20">
                    <div className="Flex-flex Flex-justifyContent--spaceBetween">
                        <p className="SubHeader">SDK</p>
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
