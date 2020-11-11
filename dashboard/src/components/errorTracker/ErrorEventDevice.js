import React from 'react';

function ErrorEventDevice() {
    return (
        <div className="Flex-flex Flex-justifyContent--spaceBetween Box-divider--border-top-1 Margin-top--16 Padding-vertical--20">
            <div className="Flex-flex">
                <div
                    style={{
                        height: '100%',
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
                    <p> 192.168.0.45 </p>
                </div>
            </div>
            <div className="Flex-flex">
                <div
                    style={{
                        height: '100%',
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
                    <p> Chrome </p>
                    <p>
                        {' '}
                        Version:{' '}
                        <span className="Text-fontWeight--light">
                            {' '}
                            58.0.3
                        </span>{' '}
                    </p>
                </div>
            </div>
            <div className="Flex-flex">
                <div
                    style={{
                        height: '100%',
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
                        {' '}
                        Family:{' '}
                        <span className="Text-fontWeight--light">
                            {' '}
                            Android
                        </span>{' '}
                    </p>
                </div>
            </div>
        </div>
    );
}

ErrorEventDevice.displayName = 'ErrorEventDevice';
export default ErrorEventDevice;
