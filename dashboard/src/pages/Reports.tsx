import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import moment from 'moment';

import { Fade } from 'react-awesome-reveal';
import Members from '../components/reports/Members';
import Monitors from '../components/reports/Monitors';
import Incidents from '../components/reports/Incidents';
import ResolveTime from '../components/reports/ResolveTime';
import Select from '../components/basic/Select';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import DateTimeRangePicker from '../components/basic/DateTimeRangePicker';

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

interface ReportsProps {
    location?: {
        pathname?: string
    };
    currentProjectId?: string;
    currentProject?: object;
    switchToProjectViewerNav?: boolean;
}

export class Reports extends Component<ReportsProps> {
    constructor(props: $TSFixMe) {
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

    handleMemberStartDateTimeChange = (val: $TSFixMe) => {
        const startDate = moment(val);

        this.handleMembersChange(startDate, this.state.membersEnd);
    };
    handleMemberEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);

        this.handleMembersChange(this.state.membersStart, endDate);
    };
    handleMembersChange(startDate: $TSFixMe, endDate: $TSFixMe) {
        this.setState({
            membersStart: startDate,
            membersEnd: endDate,
        });
    }

    handleMonitorStartDateTimeChange = (val: $TSFixMe) => {
        const startDate = moment(val);

        this.handleMonitorChange(startDate, this.state.monitorEnd);
    };
    handleMonitorEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);

        this.handleMonitorChange(this.state.monitorStart, endDate);
    };
    handleMonitorChange(startDate: $TSFixMe, endDate: $TSFixMe) {
        this.setState({
            monitorStart: startDate,
            monitorEnd: endDate,
        });
    }

    handleResolveTimeFilterChange(filter: $TSFixMe) {
        this.setState({
            resolveTimeFilter: filter,
        });
    }

    handleIncidentFilterChange(filter: $TSFixMe) {
        this.setState({
            incidentFilter: filter,
        });
    }

    handleStartDateTimeChange = (val: $TSFixMe) => {
        const startDate = moment(val);

        this.handleResolveTimeChange(startDate, this.state.resolveTimeEnd);
    };
    handleEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);

        this.handleResolveTimeChange(this.state.resolveTimeStart, endDate);
    };
    handleResolveTimeChange(startDate: $TSFixMe, endDate: $TSFixMe) {
        this.setState({
            resolveTimeStart: startDate,
            resolveTimeEnd: endDate,
        });
    }
    handleIncidentStartDateTimeChange = (val: $TSFixMe) => {
        const startDate = moment(val);

        this.handleIncidentChange(startDate, this.state.incidentEnd);
    };
    handleIncidentEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);

        this.handleIncidentChange(this.state.incidentStart, endDate);
    };

    handleIncidentChange(startDate: $TSFixMe, endDate: $TSFixMe) {
        this.setState({
            incidentStart: startDate,
            incidentEnd: endDate,
        });
    }

    render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem route={pathname} name="Reports" />
                <div className="Box-root Margin-vertical--12">
                    <div>
                        <div id="reportPage">
                            <div className="db-RadarRulesLists-page">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
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
                                                            <DateTimeRangePicker
                                                                currentDateRange={{
                                                                    startDate: this
                                                                        .state

                                                                        .resolveTimeStart,
                                                                    endDate: this
                                                                        .state

                                                                        .resolveTimeEnd,
                                                                }}
                                                                handleStartDateTimeChange={
                                                                    this
                                                                        .handleStartDateTimeChange
                                                                }
                                                                handleEndDateTimeChange={
                                                                    this
                                                                        .handleEndDateTimeChange
                                                                }
                                                                formId={
                                                                    'averageResolveTimeForm'
                                                                }
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                }}
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
                                                            this.props

                                                                .currentProjectId
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
                                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
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
                                                            <DateTimeRangePicker
                                                                currentDateRange={{
                                                                    startDate: this
                                                                        .state

                                                                        .incidentStart,
                                                                    endDate: this
                                                                        .state

                                                                        .incidentEnd,
                                                                }}
                                                                handleStartDateTimeChange={
                                                                    this
                                                                        .handleIncidentStartDateTimeChange
                                                                }
                                                                handleEndDateTimeChange={
                                                                    this
                                                                        .handleIncidentEndDateTimeChange
                                                                }
                                                                formId={
                                                                    'incidentReportForm'
                                                                }
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                }}
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
                                                            this.props

                                                                .currentProjectId
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
                                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
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
                                                            <DateTimeRangePicker
                                                                currentDateRange={{
                                                                    startDate: this
                                                                        .state

                                                                        .membersStart,
                                                                    endDate: this
                                                                        .state

                                                                        .membersEnd,
                                                                }}
                                                                handleStartDateTimeChange={
                                                                    this
                                                                        .handleMemberStartDateTimeChange
                                                                }
                                                                handleEndDateTimeChange={
                                                                    this
                                                                        .handleMemberEndDateTimeChange
                                                                }
                                                                formId={
                                                                    'memberReportForm'
                                                                }
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                }}
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
                                                        this.props

                                                            .currentProjectId
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
                                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
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
                                                            <DateTimeRangePicker
                                                                currentDateRange={{
                                                                    startDate: this
                                                                        .state

                                                                        .monitorStart,
                                                                    endDate: this
                                                                        .state

                                                                        .monitorEnd,
                                                                }}
                                                                handleStartDateTimeChange={
                                                                    this
                                                                        .handleMonitorStartDateTimeChange
                                                                }
                                                                handleEndDateTimeChange={
                                                                    this
                                                                        .handleMonitorEndDateTimeChange
                                                                }
                                                                formId={
                                                                    'monitorReportForm'
                                                                }
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                }}
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
                                                        this.props

                                                            .currentProjectId
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
            </Fade>
        );
    }
}

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProjectId:
            state.project.currentProject && state.project.currentProject._id,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};


Reports.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProjectId: PropTypes.string,
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
};


Reports.displayName = 'Reports';

export default connect(mapStateToProps, {})(Reports);
