import React, { Component } from 'react';

class ErrorEventStackTrace extends Component {
    render() {
        return (
            <div className="Box-divider--border-top-1 Padding-vertical--20">
                <div>
                    <p className="SubHeader">Exception</p>
                </div>
                <div>
                    <span className="Text-fontSize--14 Text-fontWeight--bold">
                        TypeError
                    </span>
                    <span> Cant read property text of undefined</span>
                </div>
                <div className="Flex-flex Flex-wrap--wrap">
                    <div className="Tag-Pill">
                        <div className="Tag-Title">function</div>
                        <div className="Tag-Content">getUserDetails</div>
                    </div>
                    <div className="Tag-Pill">
                        <div className="Tag-Title">handled</div>
                        <div className="Tag-Content">true</div>
                    </div>
                    <div className="Tag-Pill">
                        <div className="Tag-Title">platform</div>
                        <div className="Tag-Content">JavaScript</div>
                    </div>
                </div>
                <div className="Stacktrace-Listing">
                    <div>
                        <span className="Text-fontWeight--bold">
                            /static/js/0.chunk.js
                            {'  '}
                        </span>
                        <img
                            src="/dashboard/assets/img/external.svg"
                            alt=""
                            style={{
                                height: '12px',
                                width: '12px',
                                cursor: 'pointer',
                            }}
                        />
                        {'  '}
                        in{' '}
                        <span className="Text-fontWeight--bold">
                            dispatchDiscreteEvent
                        </span>{' '}
                        at line{' '}
                        <span className="Text-fontWeight--bold">27925:7</span>
                    </div>
                    <div>
                        <span className="Text-fontWeight--bold">
                            /static/js/0.chunk.js
                            {'  '}
                        </span>
                        <img
                            src="/dashboard/assets/img/external.svg"
                            alt=""
                            style={{
                                height: '12px',
                                width: '12px',
                                cursor: 'pointer',
                            }}
                        />
                        {'  '}
                        in{' '}
                        <span className="Text-fontWeight--bold">
                            dispatchDiscreteEvent
                        </span>{' '}
                        at line{' '}
                        <span className="Text-fontWeight--bold">27925:7</span>
                    </div>
                    <div>
                        <span className="Text-fontWeight--bold">
                            /static/js/0.chunk.js
                            {'  '}
                        </span>
                        <img
                            src="/dashboard/assets/img/external.svg"
                            alt=""
                            style={{
                                height: '12px',
                                width: '12px',
                                cursor: 'pointer',
                            }}
                        />
                        {'  '}
                        in{' '}
                        <span className="Text-fontWeight--bold">
                            dispatchDiscreteEvent
                        </span>{' '}
                        at line{' '}
                        <span className="Text-fontWeight--bold">27925:7</span>
                    </div>
                </div>
            </div>
        );
    }
}

ErrorEventStackTrace.displayName = 'ErrorEventStackTrace';
export default ErrorEventStackTrace;
