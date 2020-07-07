import React, { Fragment } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { Spinner } from '../basic/Loader';

const SecurityDetail = ({
    applicationSecurityLog,
    containerSecurityLog,
    type,
    more,
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
            <div
                className="db-Trend"
                style={{ height: '100%', cursor: 'pointer' }}
                onClick={more}
                id="issueCount"
            >
                <div className="block-chart-side line-chart">
                    {vulnerabilities ? (
                        <div className="db-TrendRow">
                            <div className="db-Trend-colInformation">
                                <div
                                    className="db-Trend-rowTitle"
                                    title="Critical Issues"
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
                                            <span className="chart-font Text-color--red">
                                                {vulnerabilities.critical}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div
                                    className="db-Trend-rowTitle"
                                    title="High Priority Issues"
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
                                            <span className="chart-font Text-color--red">
                                                {vulnerabilities.high}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div
                                    className="db-Trend-rowTitle"
                                    title="Moderate Issues"
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
                                            <span className="chart-font Text-color--yellow">
                                                {vulnerabilities.moderate}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div
                                    className="db-Trend-rowTitle"
                                    title="Low Priority Issue"
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
                                            <span className="chart-font Text-color--green">
                                                {vulnerabilities.low}
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
                                    fontSize: 14,
                                }}
                            >
                                <Spinner style={{ stroke: '#8898aa' }} />{' '}
                                <span style={{ width: 10 }} />
                                We are currently scanning this{' '}
                                {(type === 'container' && 'docker image') ||
                                    (type === 'application' &&
                                        'repository')}{' '}
                                and it will take few minutes
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
    more: PropTypes.func,
};

export default connect(null)(SecurityDetail);
