import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import moment from 'moment';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
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

export class Reports extends Component {
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'membersEnd' does not exist on type 'Read... Remove this comment to see the full error message
        this.handleMembersChange(startDate, this.state.membersEnd);
    };
    handleMemberEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'membersStart' does not exist on type 'Re... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorEnd' does not exist on type 'Read... Remove this comment to see the full error message
        this.handleMonitorChange(startDate, this.state.monitorEnd);
    };
    handleMonitorEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorStart' does not exist on type 'Re... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTimeEnd' does not exist on type '... Remove this comment to see the full error message
        this.handleResolveTimeChange(startDate, this.state.resolveTimeEnd);
    };
    handleEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTimeStart' does not exist on type... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentEnd' does not exist on type 'Rea... Remove this comment to see the full error message
        this.handleIncidentChange(startDate, this.state.incidentEnd);
    };
    handleIncidentEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentStart' does not exist on type 'R... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                                                                        tabIndex="0"
                                                                        style={{
                                                                            cursor:
                                                                                'pointer',
                                                                        }}
                                                                    >
                                                                        <span className="db-DateRangeInput-start">
                                                                            <Select
                                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: string; value: any; className: strin... Remove this comment to see the full error message
                                                                                name="filter"
                                                                                value={
                                                                                    this
                                                                                        .state
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTimeFilter' does not exist on typ... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTimeStart' does not exist on type... Remove this comment to see the full error message
                                                                        .resolveTimeStart,
                                                                    endDate: this
                                                                        .state
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTimeEnd' does not exist on type '... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ filter: any; startDate: any; endDate: any;... Remove this comment to see the full error message
                                                        filter={
                                                            this.state
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTimeFilter' does not exist on typ... Remove this comment to see the full error message
                                                                .resolveTimeFilter
                                                                .value
                                                        }
                                                        startDate={
                                                            this.state
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTimeStart' does not exist on type... Remove this comment to see the full error message
                                                                .resolveTimeStart
                                                        }
                                                        endDate={
                                                            this.state
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTimeEnd' does not exist on type '... Remove this comment to see the full error message
                                                                .resolveTimeEnd
                                                        }
                                                        currentProject={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                                                                        tabIndex="0"
                                                                        style={{
                                                                            cursor:
                                                                                'pointer',
                                                                        }}
                                                                    >
                                                                        <span className="db-DateRangeInput-start">
                                                                            <Select
                                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: string; value: any; className: strin... Remove this comment to see the full error message
                                                                                name="filter"
                                                                                value={
                                                                                    this
                                                                                        .state
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentFilter' does not exist on type '... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentStart' does not exist on type 'R... Remove this comment to see the full error message
                                                                        .incidentStart,
                                                                    endDate: this
                                                                        .state
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentEnd' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ filter: any; startDate: any; endDate: any;... Remove this comment to see the full error message
                                                        filter={
                                                            this.state
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentFilter' does not exist on type '... Remove this comment to see the full error message
                                                                .incidentFilter
                                                                .value
                                                        }
                                                        startDate={
                                                            this.state
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentStart' does not exist on type 'R... Remove this comment to see the full error message
                                                                .incidentStart
                                                        }
                                                        endDate={
                                                            this.state
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentEnd' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                .incidentEnd
                                                        }
                                                        currentProject={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'membersStart' does not exist on type 'Re... Remove this comment to see the full error message
                                                                        .membersStart,
                                                                    endDate: this
                                                                        .state
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'membersEnd' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ startDate: any; endDate: any; currentProje... Remove this comment to see the full error message
                                                    startDate={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'membersStart' does not exist on type 'Re... Remove this comment to see the full error message
                                                        this.state.membersStart
                                                    }
                                                    endDate={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'membersEnd' does not exist on type 'Read... Remove this comment to see the full error message
                                                        this.state.membersEnd
                                                    }
                                                    currentProject={
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorStart' does not exist on type 'Re... Remove this comment to see the full error message
                                                                        .monitorStart,
                                                                    endDate: this
                                                                        .state
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorEnd' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ startDate: any; endDate: any; currentProje... Remove this comment to see the full error message
                                                    startDate={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorStart' does not exist on type 'Re... Remove this comment to see the full error message
                                                        this.state.monitorStart
                                                    }
                                                    endDate={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorEnd' does not exist on type 'Read... Remove this comment to see the full error message
                                                        this.state.monitorEnd
                                                    }
                                                    currentProject={
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Reports.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProjectId: PropTypes.string,
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Reports.displayName = 'Reports';

export default connect(mapStateToProps, {})(Reports);
