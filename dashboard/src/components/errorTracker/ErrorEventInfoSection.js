import React from 'react';

function ErrorEventInfoSection() {
    return (
        <div className="Box-divider--border-top-1 Padding-vertical--20">
            <div className="Flex-flex Flex-justifyContent--spaceBetween">
                <p className="SubHeader">Browser</p>
            </div>
            <div className="Margin-vertical--8">
                <div className="Flex-flex Margin-vertical--4 ">
                    <span
                        className="Flex-flex Flex-alignItems--center"
                        style={{ width: '25%' }}
                    >
                        Brand
                    </span>
                    <span
                        style={{
                            backgroundColor: '#F7F8F9',
                            padding: '15px',
                            width: '75%',
                        }}
                    >
                        {' '}
                        Chrome Mobile
                    </span>
                </div>
                <div className="Flex-flex Margin-vertical--4">
                    <span
                        className="Flex-flex Flex-alignItems--center"
                        style={{ width: '25%' }}
                    >
                        Version
                    </span>
                    <span
                        style={{
                            backgroundColor: '#F7F8F9',
                            padding: '15px',
                            width: '75%',
                        }}
                    >
                        {' '}
                        85.9.100
                    </span>
                </div>
            </div>
        </div>
    );
}
ErrorEventInfoSection.displayName = 'ErrorEventInfoSection';
export default ErrorEventInfoSection;
