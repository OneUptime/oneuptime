import React, { Fragment } from 'react';

const SecurityDetail = () => {
    return (
        <Fragment>
            <div className="db-Trend" style={{ height: '100%' }}>
                <div className="block-chart-side line-chart">
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
                                        <span className="chart-font">0</span>
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
                                        <span className="chart-font">0</span>
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
                                        <span className="chart-font">0</span>
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
                                        <span className="chart-font">0</span>
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
                                        <span className="chart-font">0</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Fragment>
    );
};

SecurityDetail.displayName = 'SecurityDetail';

export default SecurityDetail;
