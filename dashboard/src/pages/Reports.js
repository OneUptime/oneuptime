import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import DateRangeWrapper from '../components/reports/DateRangeWrapper';
import Dashboard from '../components/Dashboard';
import Members from '../components/reports/Members';
import Monitors from '../components/reports/Monitors';
import Incidents from '../components/reports/Incidents';
import ResolveTime from '../components/reports/ResolveTime';
import Select from '../components/basic/react-select-fyipe';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';

const styles = {
    cardGrid: {
        display: 'grid',
        gridTemplateColumns: '520px 520px',
        gridGap: '30px',
    },
    number: {
        textAlign: 'center',
        borderRadius: '20px',
        background: '#f7f7f7',
        width: '100px',
    },
    incidentGrid: {
        display: 'grid',
        gridTemplateColumns: '520px 520px',
        gridGap: '30px',
    },
    innerCard: {
        paddingBottom: '78px',
    },
    arrowUp: {
        width: 0,
        height: 0,
        borderLeft: '10px solid transparent',
        borderRight: '10px solid transparent',
        borderBottom: '10px solid red',
        display: 'inline-block',
    },
    arrowDown: {
        width: 0,
        height: 0,
        borderLeft: '10px solid transparent',
        borderRight: '10px solid transparent',
        display: 'inline-block',
        borderTop: '10px solid green',
    },
    innerCardGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '5px',
    },
};

const endDate = moment();
const startDate = moment().subtract(30, 'd');

export class Reports extends Component {
    constructor(props) {
        super(props);
        this.state = {
            membersStart: startDate,
            membersEnd: endDate,
            monitorStart: startDate,
            monitorEnd: endDate,
            resolveTimeFilter: { value: 'month', label: 'Monthly' },
            incidentFilter: { value: 'month', label: 'Monthly' },
            resolveTimeStart: startDate,
            resolveTimeEnd: endDate,
            incidentStart: startDate,
            incidentEnd: endDate,
        };
        this.handleMembersChange = this.handleMembersChange.bind(this);
        this.handleMonitorChange = this.handleMonitorChange.bind(this);
        this.handleResolveTimeFilterChange = this.handleResolveTimeFilterChange.bind(
            this
        );
        this.handleIncidentFilterChange = this.handleIncidentFilterChange.bind(
            this
        );
        this.handleResolveTimeChange = this.handleResolveTimeChange.bind(this);
        this.handleIncidentChange = this.handleIncidentChange.bind(this);
    }

    handleMembersChange(startDate, endDate) {
        this.setState({
            membersStart: startDate,
            membersEnd: endDate,
        });
    }

    handleMonitorChange(startDate, endDate) {
        this.setState({
            monitorStart: startDate,
            monitorEnd: endDate,
        });
    }

    handleResolveTimeFilterChange(filter) {
        this.setState({
            resolveTimeFilter: filter,
        });
    }

    handleIncidentFilterChange(filter) {
        this.setState({
            incidentFilter: filter,
        });
    }

    handleResolveTimeChange(startDate, endDate) {
        this.setState({
            resolveTimeStart: startDate,
            resolveTimeEnd: endDate,
        });
    }

    handleIncidentChange(startDate, endDate) {
        this.setState({
            incidentStart: startDate,
            incidentEnd: endDate,
        });
    }

    ready = () => {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Reports Page Ready, Data Requested');
        }
    };

    render() {
        return (
            <Dashboard ready={this.ready}>
                <div className="Box-root Margin-vertical--12">
                    <div>
                        <div>
                            <div className="db-RadarRulesLists-page">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Average
                                                                    Resolve Time{' '}
                                                                </span>
                                                            </span>
                                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    {' '}
                                                                    Average
                                                                    incident
                                                                    resolve time
                                                                    for the past
                                                                    12 monhts
                                                                </span>
                                                            </span>
                                                        </div>

                                                        <div
                                                            className="db-Trends-timeControls Margin-horizontal--12"
                                                            style={{
                                                                justifyContent:
                                                                    'flex-end',
                                                            }}
                                                        >
                                                            <div className="db-DateRangeInputWithComparison">
                                                                <div
                                                                    className="db-DateRangeInput bs-Control"
                                                                    style={{
                                                                        cursor:
                                                                            'pointer',
                                                                        padding:
                                                                            '0',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="db-DateRangeInput-input"
                                                                        role="button"
                                                                        tabIndex="0"
                                                                        style={{
                                                                            cursor:
                                                                                'pointer',
                                                                        }}
                                                                    >
                                                                        <span className="db-DateRangeInput-start">
                                                                            <Select
                                                                                name="filter"
                                                                                value={
                                                                                    this
                                                                                        .state
                                                                                        .resolveTimeFilter
                                                                                }
                                                                                className="db-select-ne"
                                                                                onChange={
                                                                                    this
                                                                                        .handleResolveTimeFilterChange
                                                                                }
                                                                                options={[
                                                                                    {
                                                                                        value:
                                                                                            'day',
                                                                                        label:
                                                                                            'Daily',
                                                                                    },
                                                                                    {
                                                                                        value:
                                                                                            'week',
                                                                                        label:
                                                                                            'Weekly',
                                                                                    },
                                                                                    {
                                                                                        value:
                                                                                            'month',
                                                                                        label:
                                                                                            'Monthly',
                                                                                    },
                                                                                    {
                                                                                        value:
                                                                                            'year',
                                                                                        label:
                                                                                            'Yearly',
                                                                                    },
                                                                                ]}
                                                                            />
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div
                                                            className="db-Trends-timeControls"
                                                            style={{
                                                                justifyContent:
                                                                    'flex-end',
                                                            }}
                                                        >
                                                            <DateRangeWrapper
                                                                selected={
                                                                    this.state
                                                                        .resolveTimeStart
                                                                }
                                                                style={{
                                                                    justifyContent:
                                                                        'flex-end',
                                                                }}
                                                                onChange={
                                                                    this
                                                                        .handleResolveTimeChange
                                                                }
                                                                dateRange={30}
                                                            />
                                                        </div>
                                                    </div>
                                                    <ResolveTime
                                                        filter={
                                                            this.state
                                                                .resolveTimeFilter
                                                                .value
                                                        }
                                                        startDate={
                                                            this.state
                                                                .resolveTimeStart
                                                        }
                                                        endDate={
                                                            this.state
                                                                .resolveTimeEnd
                                                        }
                                                        currentProject={
                                                            this.props.match
                                                                .params
                                                                .projectId
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="Box-root Margin-bottom--12">
                                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Incidents
                                                                </span>
                                                            </span>
                                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    {' '}
                                                                    Graph
                                                                    comparing
                                                                    number of
                                                                    incidents
                                                                </span>
                                                            </span>
                                                        </div>

                                                        <div
                                                            className="db-Trends-timeControls Margin-horizontal--12"
                                                            style={{
                                                                justifyContent:
                                                                    'flex-end',
                                                            }}
                                                        >
                                                            <div className="db-DateRangeInputWithComparison">
                                                                <div
                                                                    className="db-DateRangeInput bs-Control"
                                                                    style={{
                                                                        cursor:
                                                                            'pointer',
                                                                        padding:
                                                                            '0',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="db-DateRangeInput-input"
                                                                        role="button"
                                                                        tabIndex="0"
                                                                        style={{
                                                                            cursor:
                                                                                'pointer',
                                                                        }}
                                                                    >
                                                                        <span className="db-DateRangeInput-start">
                                                                            <Select
                                                                                name="filter"
                                                                                value={
                                                                                    this
                                                                                        .state
                                                                                        .incidentFilter
                                                                                }
                                                                                className="db-select-ne"
                                                                                onChange={
                                                                                    this
                                                                                        .handleIncidentFilterChange
                                                                                }
                                                                                options={[
                                                                                    {
                                                                                        value:
                                                                                            'day',
                                                                                        label:
                                                                                            'Daily',
                                                                                    },
                                                                                    {
                                                                                        value:
                                                                                            'week',
                                                                                        label:
                                                                                            'Weekly',
                                                                                    },
                                                                                    {
                                                                                        value:
                                                                                            'month',
                                                                                        label:
                                                                                            'Monthly',
                                                                                    },
                                                                                    {
                                                                                        value:
                                                                                            'year',
                                                                                        label:
                                                                                            'Yearly',
                                                                                    },
                                                                                ]}
                                                                            />
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div
                                                            className="db-Trends-timeControls"
                                                            style={{
                                                                justifyContent:
                                                                    'flex-end',
                                                            }}
                                                        >
                                                            <DateRangeWrapper
                                                                selected={
                                                                    this.state
                                                                        .incidentStart
                                                                }
                                                                style={{
                                                                    justifyContent:
                                                                        'flex-end',
                                                                }}
                                                                onChange={
                                                                    this
                                                                        .handleIncidentChange
                                                                }
                                                                dateRange={30}
                                                            />
                                                        </div>
                                                    </div>

                                                    <Incidents
                                                        filter={
                                                            this.state
                                                                .incidentFilter
                                                                .value
                                                        }
                                                        startDate={
                                                            this.state
                                                                .incidentStart
                                                        }
                                                        endDate={
                                                            this.state
                                                                .incidentEnd
                                                        }
                                                        currentProject={
                                                            this.props.match
                                                                .params
                                                                .projectId
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="Box-root Margin-bottom--12">
                                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Members
                                                                </span>
                                                            </span>
                                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    {' '}
                                                                    Members who
                                                                    have
                                                                    resolved
                                                                    most
                                                                    incidents
                                                                </span>
                                                            </span>
                                                        </div>

                                                        <div
                                                            className="db-Trends-timeControls"
                                                            style={{
                                                                justifyContent:
                                                                    'flex-end',
                                                            }}
                                                        >
                                                            <DateRangeWrapper
                                                                selected={
                                                                    this.state
                                                                        .membersStart
                                                                }
                                                                style={{
                                                                    justifyContent:
                                                                        'flex-end',
                                                                }}
                                                                onChange={
                                                                    this
                                                                        .handleMembersChange
                                                                }
                                                                dateRange={30}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                <Members
                                                    startDate={
                                                        this.state.membersStart
                                                    }
                                                    endDate={
                                                        this.state.membersEnd
                                                    }
                                                    currentProject={
                                                        this.props.match.params
                                                            .projectId
                                                    }
                                                    styles={styles.number}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="Box-root Margin-bottom--12">
                                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Monitors
                                                                </span>
                                                            </span>
                                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Monitors
                                                                    with most
                                                                    incidents.
                                                                </span>
                                                            </span>
                                                        </div>
                                                        <div
                                                            className="db-Trends-timeControls"
                                                            style={{
                                                                justifyContent:
                                                                    'flex-end',
                                                            }}
                                                        >
                                                            <DateRangeWrapper
                                                                selected={
                                                                    this.state
                                                                        .monitorStart
                                                                }
                                                                style={{
                                                                    justifyContent:
                                                                        'flex-end',
                                                                }}
                                                                onChange={
                                                                    this
                                                                        .handleMonitorChange
                                                                }
                                                                dateRange={30}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                <Monitors
                                                    startDate={
                                                        this.state.monitorStart
                                                    }
                                                    endDate={
                                                        this.state.monitorEnd
                                                    }
                                                    currentProject={
                                                        this.props.match.params
                                                            .projectId
                                                    }
                                                    styles={styles.number}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};

Reports.propTypes = {
    match: PropTypes.object,
};

Reports.displayName = 'Reports';

export default connect(mapStateToProps, {})(Reports);
