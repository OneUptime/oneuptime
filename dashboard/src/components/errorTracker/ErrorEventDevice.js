import React from 'react';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';

function ErrorEventDevice({ errorEvent }) {
    const errorEventDetails = errorEvent.errorEvent;
    return (
        <ShouldRender
            if={
                !errorEvent.requesting &&
                errorEventDetails &&
                errorEventDetails.device
            }
        >
            <div className="Flex-flex Flex-justifyContent--spaceBetween Box-divider--border-top-1 Margin-top--16 Padding-vertical--20">
                <div className="Flex-flex">
                    <div
                        style={{
                            height: '50px',
                            width: '50px',
                            backgroundColor: '#F968BC',
                            borderRadius: '50%',
                            color: 'white',
                            textAlign: 'center',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '24px',
                        }}
                    >
                        {' '}
                        ?{' '}
                    </div>
                    <div className="Text-fontWeight--bold Margin-left--8">
                        <p>
                            {' '}
                            {errorEventDetails &&
                            errorEventDetails.user &&
                            errorEventDetails.user.ip
                                ? errorEventDetails.user.ip
                                : 'N/A'}{' '}
                        </p>
                    </div>
                </div>
                <div className="Flex-flex">
                    <div
                        style={{
                            height: '50px',
                            width: '50px',
                            backgroundColor: '#488CE0',
                            borderRadius: '50%',
                            color: 'white',
                            textAlign: 'center',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '24px',
                        }}
                    >
                        {' '}
                        ?{' '}
                    </div>
                    <div className="Text-fontWeight--bold Margin-left--8">
                        <p>
                            {' '}
                            {errorEventDetails &&
                                errorEventDetails.device &&
                                errorEventDetails.device.browser &&
                                errorEventDetails.device.browser.name}{' '}
                        </p>
                        <p>
                            {' '}
                            Version:{' '}
                            <span className="Text-fontWeight--light">
                                {' '}
                                {errorEventDetails &&
                                    errorEventDetails.device &&
                                    errorEventDetails.device.browser &&
                                    errorEventDetails.device.browser.version}
                            </span>{' '}
                        </p>
                    </div>
                </div>
                <div className="Flex-flex">
                    <div
                        style={{
                            height: '50px',
                            width: '50px',
                            backgroundColor: 'grey',
                            borderRadius: '50%',
                            color: 'white',
                            textAlign: 'center',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '24px',
                        }}
                    >
                        {' '}
                        ?{' '}
                    </div>
                    <div className="Text-fontWeight--bold Margin-left--8">
                        <p> Device </p>
                        <p>
                            {errorEventDetails &&
                                errorEventDetails.device &&
                                errorEventDetails.device.device &&
                                errorEventDetails.device.device.join(' ')}
                        </p>
                    </div>
                </div>
            </div>
        </ShouldRender>
    );
}

ErrorEventDevice.propTypes = {
    errorEvent: PropTypes.object,
};
ErrorEventDevice.displayName = 'ErrorEventDevice';
export default ErrorEventDevice;
