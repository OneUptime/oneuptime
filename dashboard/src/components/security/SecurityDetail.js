import React, { Fragment } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

const SecurityDetail = ({
    applicationSecurityLog,
    containerSecurityLog,
    type,
}) => {
    let vulnerabilities = null;
    if (applicationSecurityLog && applicationSecurityLog.data) {
        const securityLog =
            applicationSecurityLog.data && applicationSecurityLog.data;
        vulnerabilities =
            securityLog.vulnerabilities && securityLog.vulnerabilities;
    }

    if (containerSecurityLog && containerSecurityLog.data) {
        const securityLog =
            containerSecurityLog.data && containerSecurityLog.data;
        vulnerabilities =
            securityLog.vulnerabilityInfo && securityLog.vulnerabilityInfo;
    }

    return (
        <Fragment>
            <div className="db-Trend" style={{ height: '100%' }}>
                <div className="block-chart-side line-chart">
                    {vulnerabilities ? (
                        <div className="db-TrendRow">
                            <div className="db-Trend-colInformation">
                                <div
                                    className="db-Trend-rowTitle"
                                    title="Storage Used"
                                >
                                    <div className="db-Trend-title">
                                        <span className="chart-font">
                                            Critical Issues
                                        </span>
                                    </div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue">
                                        <span>
                                            {' '}
                                            <span className="chart-font">
                                                {vulnerabilities.critical}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div
                                    className="db-Trend-rowTitle"
                                    title="Storage Used"
                                >
                                    <div className="db-Trend-title">
                                        <span className="chart-font">
                                            High Priority Issues
                                        </span>
                                    </div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue">
                                        <span>
                                            {' '}
                                            <span className="chart-font">
                                                {vulnerabilities.high}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div
                                    className="db-Trend-rowTitle"
                                    title="Storage Used"
                                >
                                    <div className="db-Trend-title">
                                        <span className="chart-font">
                                            Moderate Issues
                                        </span>
                                    </div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue">
                                        <span>
                                            {' '}
                                            <span className="chart-font">
                                                {vulnerabilities.moderate}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div
                                    className="db-Trend-rowTitle"
                                    title="Storage Used"
                                >
                                    <div className="db-Trend-title">
                                        <span className="chart-font">
                                            Low Priority Issue
                                        </span>
                                    </div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue">
                                        <span>
                                            {' '}
                                            <span className="chart-font">
                                                {vulnerabilities.low}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div
                                    className="db-Trend-rowTitle"
                                    title="Storage Used"
                                >
                                    <div className="db-Trend-title">
                                        <span className="chart-font">
                                            License Compliance
                                        </span>
                                    </div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue">
                                        <span>
                                            {' '}
                                            <span className="chart-font">
                                                0
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="db-TrendRow">
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    width: '100%',
                                    fontSize: 16,
                                }}
                            >
                                We are currently scanning this{' '}
                                {(type === 'container' && ' docker image') ||
                                    (type === 'application' && ' repository')}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Fragment>
    );
};

SecurityDetail.displayName = 'SecurityDetail';

SecurityDetail.propTypes = {
    applicationSecurityLog: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    containerSecurityLog: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    type: PropTypes.string.isRequired,
};

export default connect(null)(SecurityDetail);
