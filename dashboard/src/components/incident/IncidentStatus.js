import React, { Component } from 'react';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import moment from 'moment';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import {
    acknowledgeIncident,
    resolveIncident,
    closeIncident,
    getIncidentTimeline,
    updateIncident,
} from '../../actions/incident';
import { FormLoader, Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { User } from '../../config';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import DataPathHoC from '../DataPathHoC';
import { openModal } from '../../actions/modal';
//import EditIncident from '../modals/EditIncident';
import { history } from '../../store';
import MessageBox from '../modals/MessageBox';
import { markAsRead } from '../../actions/notification';
import ViewJsonLogs from '../modals/ViewJsonLogs';
import { formatMonitorResponseTime } from '../../utils/formatMonitorResponseTime';
import FooterButton from './FooterButton';
import { animateSidebar } from '../../actions/animateSidebar';
import { reduxForm, Field, formValueSelector } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import { RenderSelect } from '../basic/RenderSelect';
export class IncidentStatus extends Component {
    constructor(props) {
        super(props);
        this.state = {
            // editIncidentModalId: uuid.v4(), unused due to code re-implementation
            messageModalId: uuid.v4(),
            viewJsonModalId: uuid.v4(),
            resolveLoad: false,
            value: undefined,
            stats: false,
            firstHover: {
                display: 'none',
            },
            secondHover: {
                display: 'none',
            },
            thirdHover: {
                display: 'none',
            },
            firstVisibility: true,
            secondVisibility: true,
            thirdVisibility: true,
        };
    }
    firstIconClick = () => {
        this.setState({
            firstVisibility: false,
        });
    };
    firstFormSubmit = values => {
        const incidentId = this.props.incident._id;
        const projectId = this.props.incident.projectId;
        const incidentType = this.props.incident.incidentType;
        const description = this.props.incident.description;
        const incidentPriority = this.props.incident.incidentPriority._id;

        this.props
            .updateIncident(
                projectId,
                incidentId,
                incidentType,
                values.title,
                description,
                incidentPriority
            )
            .then(() => {
                this.setState({
                    firstVisibility: true,
                    firstHover: {
                        display: 'none',
                    },
                });
            });
    };
    secondIconClick = () => {
        this.setState({
            secondVisibility: false,
        });
    };
    secondFormSubmit = () => {
        const incidentId = this.props.incident._id;
        const projectId = this.props.incident.projectId;
        const incidentType = this.props.incident.incidentType;
        const title = this.props.incident.title;
        const description = this.props.description;
        const incidentPriority = this.props.incident.incidentPriority._id;
        this.props
            .updateIncident(
                projectId,
                incidentId,
                incidentType,
                title,
                description,
                incidentPriority
            )
            .then(() => {
                this.setState({
                    secondVisibility: true,
                    secondHover: {
                        display: 'none',
                    },
                });
            });
    };
    thirdIconClick = () => {
        this.setState({
            thirdVisibility: false,
        });
    };
    thirdFormSubmit = (e, value) => {
        const incidentId = this.props.incident._id;
        const projectId = this.props.incident.projectId;
        const incidentType = this.props.incident.incidentType;
        const title = this.props.incident.title;
        const description = this.props.incident.description;
        const incidentPriority = value;
        this.props
            .updateIncident(
                projectId,
                incidentId,
                incidentType,
                title,
                description,
                incidentPriority
            )
            .then(() => {
                this.setState({
                    thirdVisibility: true,
                    thirdHover: {
                        display: 'none',
                    },
                });
            });
    };
    acknowledge = async setLoading => {
        const userId = User.getUserId();
        await this.props
            .acknowledgeIncident(
                this.props.incident.projectId,
                this.props.incident._id,
                userId,
                this.props.multiple
            )
            .then(() => {
                this.setState({ resolveLoad: false });
                this.props.markAsRead(
                    this.props.incident.projectId,
                    this.props.incident.notificationId
                );
                if (setLoading) {
                    setLoading(false);
                }
                this.props.getIncidentTimeline(
                    this.props.currentProject._id,
                    this.props.incident._id,
                    parseInt(0),
                    parseInt(10)
                );
            });
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > INCIDENT ACKNOWLEDGED',
                {
                    ProjectId: this.props.incident.projectId,
                    incidentId: this.props.incident._id,
                    userId: userId,
                }
            );
        }
    };

    resolve = async setLoading => {
        const userId = User.getUserId();
        await this.props
            .resolveIncident(
                this.props.incident.projectId,
                this.props.incident._id,
                userId,
                this.props.multiple
            )
            .then(() => {
                this.setState({ resolveLoad: false, value: '', stats: false });
                if (setLoading) {
                    setLoading(false);
                }
                this.props.markAsRead(
                    this.props.incident.projectId,
                    this.props.incident.notificationId
                );
                this.props.getIncidentTimeline(
                    this.props.currentProject._id,
                    this.props.incident._id,
                    parseInt(0),
                    parseInt(10)
                );
            });
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > INCIDENT RESOLVED',
                {
                    ProjectId: this.props.incident.projectId,
                    incidentId: this.props.incident._id,
                    userId: userId,
                }
            );
        }
    };

    closeIncident = () => {
        this.props.closeIncident(
            this.props.incident.projectId,
            this.props.incident._id
        );
    };

    handleIncident = (value, stats, setLoading) => {
        if (!this.props.incident.acknowledged) {
            this.setState({ resolveLoad: true, value, stats });
            this.acknowledge(setLoading);
        } else if (
            this.props.incident.acknowledged &&
            !this.props.incident.resolved
        ) {
            this.setState({ resolveLoad: true, value, stats });
            this.resolve(setLoading);
        }
    };

    getOnCallTeamMembers = () => {
        const monitorId =
            (this.props.multiple &&
                this.props.incident &&
                this.props.incident.monitorId) ||
            (this.props.incident && this.props.incident.monitorId)
                ? this.props.incident.monitorId._id
                : '';
        const escalation = this.props.escalations
            ? this.props.escalations.find(
                  escalation =>
                      escalation.scheduleId &&
                      escalation.scheduleId.monitorIds &&
                      escalation.scheduleId.monitorIds.length > 0 &&
                      escalation.scheduleId.monitorIds.some(
                          monitor => monitor._id === monitorId
                      )
              )
            : null;
        return escalation && escalation.teams && escalation.teams[0]
            ? escalation.teams[0].teamMembers
            : null;
    };

    render() {
        const subProject =
            this.props.subProjects &&
            this.props.subProjects.filter(
                subProject => subProject._id === this.props.incident.projectId
            )[0];
        const loggedInUser = User.getUserId();
        const isUserInProject =
            this.props.currentProject &&
            this.props.currentProject.users.some(
                user => user.userId === loggedInUser
            );
        let isUserInSubProject = false;
        if (isUserInProject) isUserInSubProject = true;
        else
            isUserInSubProject = subProject.users.some(
                user => user.userId === loggedInUser
            );
        const monitorName =
            (this.props.multiple &&
                this.props.incident &&
                this.props.incident.monitorId) ||
            (this.props.incident && this.props.incident.monitorId)
                ? this.props.incident.monitorId.name
                : '';
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : '';
        const incidentId = this.props.incident ? this.props.incident._id : '';
        const componentId = this.props.incident
            ? this.props.incident.monitorId.componentId._id
            : '';
        const homeRoute = this.props.currentProject
            ? '/dashboard/project/' + this.props.currentProject.slug
            : '';
        const monitorRoute = this.props.currentProject
            ? '/dashboard/project/' +
              this.props.currentProject.slug +
              '/' +
              componentId +
              '/monitoring'
            : '';
        const incidentRoute = this.props.currentProject
            ? '/dashboard/project/' +
              this.props.currentProject.slug +
              '/' +
              componentId +
              '/incidents/' +
              this.props.incident._id
            : '';

        const showResolveButton = this.props.multipleIncidentRequest
            ? !this.props.multipleIncidentRequest.resolving
            : this.props.incidentRequest &&
              !this.props.incidentRequest.resolving;

        const incidentReason =
            this.props.incident.reason &&
            changeFormat(this.props.incident.reason);

        function changeFormat(data) {
            let result;
            const strArr = data.split('\n');
            const regex = /did\s{1,}not\s{1,}evaluate/;
            const patt = new RegExp(regex);
            let success = false;
            for (let i = 0; i < strArr.length; i++) {
                if (patt.test(strArr[i])) {
                    success = true;
                    strArr[i] = `did not evaluate ${strArr[i]
                        .split(regex)
                        .splice(1, strArr[i].length - 1)}`;
                }
            }
            if (success) {
                result = strArr.join('\n');
            } else {
                result = data;
            }
            return result.replace('did', 'Did').split('\n');
        }

        const formatAckDate = (otherDate, createdDate) => {
            const sec = moment(moment(otherDate).toArray()).diff(
                moment(moment(createdDate).toArray()),
                'seconds'
            );
            const minutes = moment(moment(otherDate).toArray()).diff(
                moment(moment(createdDate).toArray()),
                'minutes'
            );
            const hours = moment(moment(otherDate).toArray()).diff(
                moment(moment(createdDate).toArray()),
                'hours'
            );
            const days = moment(moment(otherDate).toArray()).diff(
                moment(moment(createdDate).toArray()),
                'days'
            );
            const weeks = moment(moment(otherDate).toArray()).diff(
                moment(moment(createdDate).toArray()),
                'weeks'
            );
            const months = moment(moment(otherDate).toArray()).diff(
                moment(moment(createdDate).toArray()),
                'months'
            );
            const years = moment(moment(otherDate).toArray()).diff(
                moment(moment(createdDate).toArray()),
                'years'
            );
            let valueTxt;
            if (sec < 60) {
                valueTxt = sec > 1 ? `${sec} seconds` : `a second`;
            } else if (sec < 3600) {
                valueTxt = minutes > 1 ? `${minutes} minutes` : `a minute`;
            } else if (sec < 86400) {
                valueTxt = hours > 1 ? `${hours} hours` : `an hour`;
            } else if (sec < 7 * 86400) {
                valueTxt = days > 1 ? `${days} days` : `a day`;
            } else if (sec < 4 * 7 * 86400) {
                valueTxt = weeks > 1 ? `${weeks} weeks` : `a week`;
            } else if (sec < 4 * 7 * 12 * 86400) {
                valueTxt = months > 1 ? `${months} months` : `a month`;
            } else {
                valueTxt = years > 1 ? `${years} years` : `a year`;
            }
            return valueTxt;
        };

        const team = this.getOnCallTeamMembers();

        return (
            <>
                <ShouldRender
                    if={
                        (!this.props.route ||
                            (this.props.route &&
                                !(
                                    this.props.route === homeRoute ||
                                    this.props.route === monitorRoute
                                ))) &&
                        this.props.incident.acknowledged &&
                        this.props.incident.resolved &&
                        !this.props.incidentRequest.requesting
                    }
                >
                    <div className="Box-root Flex-flex Flex-direction--row Flex-alignItems--center Box-background--green Text-color--white Border-radius--4 Text-fontWeight--bold Padding-horizontal--20 Padding-vertical--12 pointer Card-shadow--medium bs-mar-cursor">
                        <span
                            className="db-SideNav-icon db-SideNav-icon--tick db-SideNav-icon--selected"
                            style={{
                                filter: 'brightness(0) invert(1)',
                                marginTop: '1px',
                                marginRight: '3px',
                            }}
                        ></span>
                        <span>This incident is resolved</span>
                    </div>
                </ShouldRender>
                <div
                    id={`incident_${this.props.count}`}
                    className="Box-root Margin-bottom--12"
                >
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root">
                                    <div className="bs-flex-display">
                                        <div className="bs-incident-title bs-i-title">
                                            <div>INCIDENT</div>
                                            <div className="bs-numb">{`#${this.props.incident.idNumber}`}</div>
                                        </div>
                                        <div className="bs-incident-title bs-i-title-right">
                                            <div className="bs--header">
                                                <div className="bs-font-header">
                                                    {monitorName} is{' '}
                                                    {
                                                        this.props.incident
                                                            .incidentType
                                                    }
                                                </div>
                                                {((incidentReason &&
                                                    incidentReason.length >
                                                        1) ||
                                                    this.props.incident
                                                        .monitorId.type ===
                                                        'api' ||
                                                    (incidentReason &&
                                                        incidentReason.length ===
                                                            1 &&
                                                        incidentReason.join()
                                                            .length > 30)) && (
                                                    <div className="bs-redun">
                                                        Acknowledge and Resolve
                                                        this incident.
                                                    </div>
                                                )}
                                                {this.props.incident
                                                    .manuallyCreated &&
                                                    this.props.incident
                                                        .createdById && (
                                                        <div className="bs-flex-display">
                                                            <span className="bs-font-normal">
                                                                Cause:&nbsp;{' '}
                                                            </span>
                                                            <span className="bs-flex-display bs-font-normal">
                                                                <span>
                                                                    This
                                                                    incident was
                                                                    created by
                                                                </span>
                                                                <Link
                                                                    style={{
                                                                        textDecoration:
                                                                            'underline',
                                                                        marginLeft:
                                                                            '4px',
                                                                    }}
                                                                    to={
                                                                        '/dashboard/profile/' +
                                                                        this
                                                                            .props
                                                                            .incident
                                                                            .createdById
                                                                            ._id
                                                                    }
                                                                >
                                                                    <div>
                                                                        {
                                                                            this
                                                                                .props
                                                                                .incident
                                                                                .createdById
                                                                                .name
                                                                        }
                                                                    </div>
                                                                </Link>
                                                            </span>
                                                        </div>
                                                    )}
                                                {this.props.incident
                                                    .incidentType &&
                                                    this.props.incident
                                                        .reason &&
                                                    incidentReason &&
                                                    incidentReason.length ===
                                                        1 &&
                                                    this.props.incident
                                                        .monitorId.type !==
                                                        'api' &&
                                                    incidentReason &&
                                                    incidentReason.join()
                                                        .length <= 30 && (
                                                        <div className="bs-font-normal bs-flex-display">
                                                            <label className="bs-h">
                                                                Cause:
                                                            </label>
                                                            <div
                                                                className="bs-content-inside bs-status"
                                                                id={`${monitorName}_IncidentReport_${this.props.count}`}
                                                            >
                                                                <ReactMarkdown
                                                                    source={`${' ' +
                                                                        incidentReason.map(
                                                                            a => {
                                                                                if (
                                                                                    a.includes(
                                                                                        'Response Time'
                                                                                    )
                                                                                ) {
                                                                                    const milliSeconds = a.match(
                                                                                        /\d+/
                                                                                    )[0];
                                                                                    const time = formatMonitorResponseTime(
                                                                                        Number(
                                                                                            milliSeconds
                                                                                        )
                                                                                    );
                                                                                    return a.replace(
                                                                                        milliSeconds +
                                                                                            ' ms',
                                                                                        time
                                                                                    );
                                                                                } else {
                                                                                    return a;
                                                                                }
                                                                            }
                                                                        ) +
                                                                        '.'}`}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16 bs-mob-flex">
                                    <div
                                        className={
                                            this.props.incident.acknowledged &&
                                            this.props.incident.resolved
                                                ? 'bs-flex-display bs-remove-shadow'
                                                : 'bs-flex-display'
                                        }
                                    >
                                        {this.props.incident.acknowledged &&
                                            this.props.incident.resolved &&
                                            this.props.route &&
                                            !(
                                                this.props.route ===
                                                incidentRoute
                                            ) && (
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    viewBox="0 0 24 24"
                                                    style={{
                                                        margin:
                                                            '2px 3px 0px 0px',
                                                    }}
                                                    className="bs-g"
                                                    width="18"
                                                    height="18"
                                                >
                                                    <path
                                                        fill="none"
                                                        d="M0 0h24v24H0z"
                                                    />
                                                    <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm-.997-4L6.76 11.757l1.414-1.414 2.829 2.829 5.656-5.657 1.415 1.414L11.003 16z" />
                                                </svg>
                                            )}
                                        {(!this.props.incident.acknowledged ||
                                            !this.props.incident.resolved) && (
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 24 24"
                                                style={{
                                                    margin: '2px 3px 0px 0px',
                                                }}
                                                className="bs-red-icon"
                                                width="18"
                                                height="18"
                                            >
                                                <path
                                                    fill="none"
                                                    d="M0 0h24v24H0z"
                                                />
                                                <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm-1-5h2v2h-2v-2zm0-8h2v6h-2V7z" />
                                            </svg>
                                        )}
                                        <div
                                            className={
                                                this.props.incident
                                                    .acknowledged &&
                                                this.props.incident.resolved
                                                    ? 'bs-resolved-green'
                                                    : 'bs-exclaim'
                                            }
                                        >
                                            {!this.props.incident
                                                .acknowledged ? (
                                                <span className="bs-active-in">
                                                    This is an Active Incident
                                                </span>
                                            ) : this.props.incident
                                                  .acknowledged &&
                                              !this.props.incident.resolved ? (
                                                <span className="bs-active-in">
                                                    This is an Active Incident
                                                </span>
                                            ) : this.props.route &&
                                              !(
                                                  this.props.route ===
                                                  incidentRoute
                                              ) ? (
                                                <span className="">
                                                    The Incident is Resolved
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                    {/* <ShouldRender
                                        if={
                                            !this.props.route ||
                                            (this.props.route &&
                                                !(
                                                    this.props.route ===
                                                    homeRoute ||
                                                    this.props.route ===
                                                    monitorRoute
                                                ))
                                        }
                                    >
                                        <button
                                            className="bs-Button bs-Button--icon bs-Button--settings bs-margin-right-1"
                                            id={`${monitorName}_EditIncidentDetails`}
                                            type="button"
                                            onClick={() => {
                                                this.props.openModal({
                                                    id: this.state
                                                        .editIncidentModalId,
                                                    content: DataPathHoC(
                                                        EditIncident,
                                                        {
                                                            incident: this.props
                                                                .incident,
                                                            incidentId: this
                                                                .props.incident
                                                                ._id,
                                                        }
                                                    ),
                                                });
                                            }}
                                        >
                                            <span>Edit Incident</span>
                                        </button>
                                    </ShouldRender> */}
                                </div>
                            </div>
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows bs-header bs-content-1">
                                                <div className="bs-left-side">
                                                    <div className="bs-content">
                                                        <label>
                                                            Incident ID
                                                        </label>
                                                        <div className="bs-content-inside">
                                                            <span
                                                                className="value"
                                                                style={{
                                                                    marginTop:
                                                                        '6px',
                                                                    fontWeight:
                                                                        '600',
                                                                    fontSize:
                                                                        '18px',
                                                                }}
                                                            >
                                                                {`#${this.props.incident.idNumber}`}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="bs-content">
                                                        <label className="">
                                                            Monitor
                                                        </label>
                                                        <div className="bs-content-inside">
                                                            <span className="value">
                                                                <Link
                                                                    style={{
                                                                        textDecoration:
                                                                            'underline',
                                                                    }}
                                                                    to={
                                                                        '/dashboard/project/' +
                                                                        this
                                                                            .props
                                                                            .currentProject
                                                                            .slug +
                                                                        '/' +
                                                                        componentId +
                                                                        '/monitoring'
                                                                    }
                                                                    id="backToComponentView"
                                                                >
                                                                    {
                                                                        this
                                                                            .props
                                                                            .incident
                                                                            .monitorId
                                                                            .componentId
                                                                            .name
                                                                    }
                                                                </Link>
                                                            </span>
                                                            {' / '}
                                                            <span className="value">
                                                                <Link
                                                                    style={{
                                                                        textDecoration:
                                                                            'underline',
                                                                    }}
                                                                    to={
                                                                        '/dashboard/project/' +
                                                                        this
                                                                            .props
                                                                            .currentProject
                                                                            .slug +
                                                                        '/' +
                                                                        componentId +
                                                                        '/monitoring/' +
                                                                        this
                                                                            .props
                                                                            .incident
                                                                            .monitorId
                                                                            ._id
                                                                    }
                                                                    id="backToMonitorView"
                                                                >
                                                                    {
                                                                        this
                                                                            .props
                                                                            .incident
                                                                            .monitorId
                                                                            .name
                                                                    }
                                                                </Link>
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="bs-content">
                                                        <label className="">
                                                            Incident Status:
                                                        </label>
                                                        <div className="bs-content-inside bs-margin-off">
                                                            <span className="value">
                                                                {this.props
                                                                    .incident &&
                                                                this.props
                                                                    .incident
                                                                    .incidentType &&
                                                                this.props
                                                                    .incident
                                                                    .incidentType ===
                                                                    'offline' ? (
                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center bs-padding-x">
                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper bs-font-increase">
                                                                            <span>
                                                                                offline
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                ) : this.props
                                                                      .incident &&
                                                                  this.props
                                                                      .incident
                                                                      .incidentType &&
                                                                  this.props
                                                                      .incident
                                                                      .incidentType ===
                                                                      'online' ? (
                                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center bs-padding-x">
                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper bs-font-increase">
                                                                            <span>
                                                                                online
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                ) : this.props
                                                                      .incident &&
                                                                  this.props
                                                                      .incident
                                                                      .incidentType &&
                                                                  this.props
                                                                      .incident
                                                                      .incidentType ===
                                                                      'degraded' ? (
                                                                    <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                        <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper bs-font-increase">
                                                                            <span>
                                                                                degraded
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                ) : (
                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper">
                                                                            <span>
                                                                                Unknown
                                                                                Status
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="bs-content">
                                                        <label className="">
                                                            Incident Timeline
                                                        </label>
                                                        <div>
                                                            <div className="bs-content-inside bs-margin-top-1">
                                                                <div className="bs-flex-display bs-justify-cont">
                                                                    <div className="bs-circle bs-circle-o"></div>
                                                                    <div className="bs-margin-right">
                                                                        <span className="bs-content-create bs-text-bold">
                                                                            Created
                                                                            by
                                                                        </span>
                                                                        <span className=" bs-text-bold">
                                                                            {this
                                                                                .props
                                                                                .incident
                                                                                .createdById ? (
                                                                                <Link
                                                                                    style={{
                                                                                        textDecoration:
                                                                                            'underline',
                                                                                        marginLeft:
                                                                                            '4px',
                                                                                    }}
                                                                                    to={
                                                                                        '/dashboard/profile/' +
                                                                                        this
                                                                                            .props
                                                                                            .incident
                                                                                            .createdById
                                                                                            ._id
                                                                                    }
                                                                                >
                                                                                    {
                                                                                        this
                                                                                            .props
                                                                                            .incident
                                                                                            .createdById
                                                                                            .name
                                                                                    }
                                                                                </Link>
                                                                            ) : this
                                                                                  .props
                                                                                  .incident
                                                                                  .createdByZapier ? (
                                                                                'Zapier'
                                                                            ) : this
                                                                                  .props
                                                                                  .incident
                                                                                  .probes &&
                                                                              this
                                                                                  .props
                                                                                  .incident
                                                                                  .probes[0] &&
                                                                              this
                                                                                  .props
                                                                                  .incident
                                                                                  .probes[0]
                                                                                  .probeId ? (
                                                                                this
                                                                                    .props
                                                                                    .incident
                                                                                    .probes[0]
                                                                                    .probeId
                                                                                    .probeName +
                                                                                ' probe'
                                                                            ) : (
                                                                                'Fyipe'
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                </div>

                                                                <div className="bs-flex-display bs-margin-top-1 bs-justify-cont bs-margin-bottom bs-padding-left">
                                                                    <span className="bs-bullet-container">
                                                                        <span className="bs-dark-bullet"></span>
                                                                    </span>
                                                                    <div className="bs-margin-right">
                                                                        <span className="bs-content-create">
                                                                            Created
                                                                            at
                                                                        </span>
                                                                        <span className="bs-date-create">
                                                                            {moment(
                                                                                this
                                                                                    .props
                                                                                    .incident
                                                                                    .createdAt
                                                                            ).format(
                                                                                'h:mm:ss a'
                                                                            )}
                                                                            <br />
                                                                            (
                                                                            {moment(
                                                                                this
                                                                                    .props
                                                                                    .incident
                                                                                    .createdAt
                                                                            ).fromNow()}
                                                                            ).
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {!this.props.incident
                                                            .acknowledged && (
                                                            <div className="bs-content bs-margin-top">
                                                                <div className="bs-content-inside">
                                                                    <div
                                                                        className="bs-font-increase"
                                                                        title="Let your team know you’re working on this incident."
                                                                    >
                                                                        <div>
                                                                            <ShouldRender
                                                                                if={
                                                                                    showResolveButton
                                                                                }
                                                                            >
                                                                                <label className="Bs-btn-no bs-flex-display bs-margin-left">
                                                                                    <svg
                                                                                        xmlns="http://www.w3.org/2000/svg"
                                                                                        viewBox="0 0 24 24"
                                                                                        className="bs-ack-red"
                                                                                        width="18"
                                                                                        height="18"
                                                                                    >
                                                                                        <path
                                                                                            fill="none"
                                                                                            d="M0 0h24v24H0z"
                                                                                        />
                                                                                        <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
                                                                                    </svg>
                                                                                    <div className="bs-margin-right bs-font-transform">
                                                                                        This
                                                                                        is
                                                                                        an
                                                                                        Active
                                                                                        Incident
                                                                                    </div>
                                                                                </label>
                                                                            </ShouldRender>
                                                                        </div>
                                                                    </div>
                                                                    <div className="bs-ma-top">
                                                                        <div className="bs-action-label">
                                                                            ACTION
                                                                            REQUIRED
                                                                        </div>
                                                                        <button
                                                                            id={`btnAcknowledge_${this.props.count}`}
                                                                            onClick={() =>
                                                                                this.handleIncident(
                                                                                    1,
                                                                                    true
                                                                                )
                                                                            }
                                                                            className="bs-Button bs-flex-display bs--ma"
                                                                        >
                                                                            <ShouldRender
                                                                                if={
                                                                                    ((this
                                                                                        .props
                                                                                        .incidentRequest &&
                                                                                        this
                                                                                            .props
                                                                                            .incidentRequest
                                                                                            .requesting) ||
                                                                                        (this
                                                                                            .props
                                                                                            .multipleIncidentRequest &&
                                                                                            this
                                                                                                .props
                                                                                                .multipleIncidentRequest
                                                                                                .requesting) ||
                                                                                        (this
                                                                                            .props
                                                                                            .incidentRequest &&
                                                                                            this
                                                                                                .props
                                                                                                .incidentRequest
                                                                                                .resolving) ||
                                                                                        (this
                                                                                            .props
                                                                                            .multipleIncidentRequest &&
                                                                                            this
                                                                                                .props
                                                                                                .multipleIncidentRequest
                                                                                                .resolving)) &&
                                                                                    this
                                                                                        .state
                                                                                        .value ===
                                                                                        1 &&
                                                                                    this
                                                                                        .state
                                                                                        .stats
                                                                                }
                                                                            >
                                                                                <Spinner
                                                                                    style={{
                                                                                        stroke:
                                                                                            '#000000',
                                                                                    }}
                                                                                />
                                                                            </ShouldRender>
                                                                            {this
                                                                                .state
                                                                                .resolveLoad ? null : !this
                                                                                  .props
                                                                                  .incident
                                                                                  .acknowledged &&
                                                                              !this
                                                                                  .state
                                                                                  .resolveLoad &&
                                                                              this
                                                                                  .state
                                                                                  .value !==
                                                                                  1 &&
                                                                              !this
                                                                                  .state
                                                                                  .stats ? (
                                                                                <div className="bs-circle"></div>
                                                                            ) : null}
                                                                            <span>
                                                                                Acknowledge
                                                                                Incident
                                                                            </span>
                                                                        </button>
                                                                        <p className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                Let
                                                                                your
                                                                                team
                                                                                know
                                                                                you&#39;re
                                                                                working
                                                                                on
                                                                                this
                                                                                incident.
                                                                            </span>
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {this.props.incident
                                                            .acknowledged ? (
                                                            <>
                                                                <div>
                                                                    <div className="bs-content-inside bs-margin-top-1">
                                                                        <div className="bs-flex-display bs-justify-cont">
                                                                            <svg
                                                                                xmlns="http://www.w3.org/2000/svg"
                                                                                viewBox="0 0 24 24"
                                                                                className="bs-ack-yellow"
                                                                                width="18"
                                                                                height="18"
                                                                            >
                                                                                <path
                                                                                    fill="none"
                                                                                    d="M0 0h24v24H0z"
                                                                                />
                                                                                <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
                                                                            </svg>
                                                                            <div
                                                                                id={`AcknowledgeText_${this.props.count}`}
                                                                                className="bs-margin-right bs-text-bold"
                                                                            >
                                                                                Acknowledged
                                                                                by{' '}
                                                                                {this
                                                                                    .props
                                                                                    .incident
                                                                                    .acknowledgedBy ===
                                                                                null ? (
                                                                                    <span>
                                                                                        {this
                                                                                            .props
                                                                                            .incident
                                                                                            .acknowledgedByZapier
                                                                                            ? 'Zapier'
                                                                                            : this
                                                                                                  .props
                                                                                                  .incident
                                                                                                  .acknowledgedByIncomingHttpRequest
                                                                                            ? `Incoming HTTP Request ${this.props.incident.acknowledgedByIncomingHttpRequest.name}`
                                                                                            : 'Fyipe'}
                                                                                    </span>
                                                                                ) : (
                                                                                    <Link
                                                                                        style={{
                                                                                            textDecoration:
                                                                                                'underline',
                                                                                        }}
                                                                                        to={
                                                                                            '/dashboard/profile/' +
                                                                                            this
                                                                                                .props
                                                                                                .incident
                                                                                                .acknowledgedBy
                                                                                                ._id
                                                                                        }
                                                                                    >
                                                                                        {
                                                                                            this
                                                                                                .props
                                                                                                .incident
                                                                                                .acknowledgedBy
                                                                                                .name
                                                                                        }
                                                                                    </Link>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-flex-display bs-justify-cont bs-margin-top-1  bs-padding-left ">
                                                                            <span className="bs-bullet-container">
                                                                                <span className="bs-dark-bullet"></span>
                                                                            </span>
                                                                            <div
                                                                                // id={`AcknowledgeText_${this.props.count}`}
                                                                                className="bs-margin-right "
                                                                            >
                                                                                Acknowledged
                                                                                on{' '}
                                                                                {moment(
                                                                                    this
                                                                                        .props
                                                                                        .incident
                                                                                        .acknowledgedAt
                                                                                ).format(
                                                                                    'MMMM Do YYYY'
                                                                                )}{' '}
                                                                                at{' '}
                                                                                {moment(
                                                                                    this
                                                                                        .props
                                                                                        .incident
                                                                                        .acknowledgedAt
                                                                                ).format(
                                                                                    'h:mm:ss a'
                                                                                )}{' '}
                                                                                (
                                                                                {moment(
                                                                                    this
                                                                                        .props
                                                                                        .incident
                                                                                        .acknowledgedAt
                                                                                ).fromNow()}

                                                                                ){' '}
                                                                                {
                                                                                    '. '
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-flex-display bs-justify-cont  bs-padding-left">
                                                                            <span className="bs-bullet-container">
                                                                                <span className="bs-dark-bullet"></span>
                                                                            </span>
                                                                            <span className="bs-margin-right">
                                                                                It
                                                                                took{' '}
                                                                                {formatAckDate(
                                                                                    this
                                                                                        .props
                                                                                        .incident
                                                                                        .acknowledgedAt,
                                                                                    this
                                                                                        .props
                                                                                        .incident
                                                                                        .createdAt
                                                                                )}{' '}
                                                                                to
                                                                                acknowledge
                                                                                this
                                                                                incident.
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </>
                                                        ) : isUserInSubProject ? (
                                                            <div></div>
                                                        ) : (
                                                            <>
                                                                <div className="bs-content-inside">
                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper">
                                                                            <span>
                                                                                Not
                                                                                Acknowledged
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </>
                                                        )}
                                                        {this.props.incident
                                                            .resolved ? (
                                                            <>
                                                                <div
                                                                    className="bs-content bs-margin-top"
                                                                    style={{
                                                                        marginTop:
                                                                            '10px',
                                                                    }}
                                                                >
                                                                    <div className="bs-content-inside">
                                                                        <div>
                                                                            <div className="bs-flex-display bs-justify-cont bs-m-top">
                                                                                <div className="bs-circle-span-green"></div>
                                                                                <div
                                                                                    id={`ResolveText_${this.props.count}`}
                                                                                    className="bs-margin-right bs-text-bold"
                                                                                >
                                                                                    Resolved
                                                                                    by{' '}
                                                                                    {this
                                                                                        .props
                                                                                        .incident
                                                                                        .resolvedBy ===
                                                                                    null ? (
                                                                                        <span>
                                                                                            {this
                                                                                                .props
                                                                                                .incident
                                                                                                .resolvedByZapier
                                                                                                ? 'Zapier'
                                                                                                : this
                                                                                                      .props
                                                                                                      .incident
                                                                                                      .resolvedByIncomingHttpRequest
                                                                                                ? `Incoming HTTP Request ${this.props.incident.resolvedByIncomingHttpRequest.name}`
                                                                                                : 'Fyipe'}
                                                                                        </span>
                                                                                    ) : (
                                                                                        <Link
                                                                                            style={{
                                                                                                textDecoration:
                                                                                                    'underline',
                                                                                            }}
                                                                                            to={
                                                                                                '/dashboard/profile/' +
                                                                                                this
                                                                                                    .props
                                                                                                    .incident
                                                                                                    .resolvedBy
                                                                                                    ._id
                                                                                            }
                                                                                        >
                                                                                            {
                                                                                                this
                                                                                                    .props
                                                                                                    .incident
                                                                                                    .resolvedBy
                                                                                                    .name
                                                                                            }{' '}
                                                                                        </Link>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                            <div className="bs-flex-display bs-justify-cont bs-margin-top-1  bs-padding-left">
                                                                                <span className="bs-bullet-container">
                                                                                    <span className="bs-dark-bullet"></span>
                                                                                </span>
                                                                                <div
                                                                                    id={`ResolveText_${this.props.count}`}
                                                                                    className="bs-margin-right"
                                                                                >
                                                                                    Resolved
                                                                                    on{' '}
                                                                                    {moment(
                                                                                        this
                                                                                            .props
                                                                                            .incident
                                                                                            .resolvedAt
                                                                                    ).format(
                                                                                        'MMMM Do YYYY'
                                                                                    )}{' '}
                                                                                    at{' '}
                                                                                    {moment(
                                                                                        this
                                                                                            .props
                                                                                            .incident
                                                                                            .resolvedAt
                                                                                    ).format(
                                                                                        'h:mm:ss a'
                                                                                    )}{' '}
                                                                                    (
                                                                                    {moment(
                                                                                        this
                                                                                            .props
                                                                                            .incident
                                                                                            .resolvedAt
                                                                                    ).fromNow()}

                                                                                    )
                                                                                    {
                                                                                        '. '
                                                                                    }
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-flex-display bs-justify-cont  bs-padding-left">
                                                                            <span className="bs-bullet-container">
                                                                                <span className="bs-dark-bullet"></span>
                                                                            </span>
                                                                            <span className="bs-margin-right">
                                                                                It
                                                                                took{' '}
                                                                                {formatAckDate(
                                                                                    this
                                                                                        .props
                                                                                        .incident
                                                                                        .resolvedAt,
                                                                                    this
                                                                                        .props
                                                                                        .incident
                                                                                        .createdAt
                                                                                )}{' '}
                                                                                to
                                                                                resolve
                                                                                this
                                                                                incident.
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </>
                                                        ) : isUserInSubProject ? (
                                                            <>
                                                                {this.props
                                                                    .incident
                                                                    .acknowledged && (
                                                                    <div className="bs-content bs-margin-top">
                                                                        <div className="bs-content-inside">
                                                                            <div
                                                                                className="bs-font-increase"
                                                                                title="Let your team know you've fixed this incident."
                                                                            >
                                                                                <div>
                                                                                    <ShouldRender
                                                                                        if={
                                                                                            showResolveButton
                                                                                        }
                                                                                    >
                                                                                        <label className="Bs-btn-no bs-flex-display bs-margin-left">
                                                                                            <div className="bs-circle-span"></div>
                                                                                            <div className="bs-margin-right">
                                                                                                Not
                                                                                                Resolved
                                                                                            </div>
                                                                                        </label>
                                                                                    </ShouldRender>
                                                                                </div>
                                                                            </div>
                                                                            <div className="bs-ma-top">
                                                                                <div className="bs-action-label">
                                                                                    ACTION
                                                                                    REQUIRED
                                                                                </div>
                                                                                <button
                                                                                    id={`btnResolve_${this.props.count}`}
                                                                                    onClick={() =>
                                                                                        this.handleIncident(
                                                                                            2
                                                                                        )
                                                                                    }
                                                                                    className="bs-Button bs-flex-display bs--ma"
                                                                                >
                                                                                    <ShouldRender
                                                                                        if={
                                                                                            ((this
                                                                                                .props
                                                                                                .incidentRequest &&
                                                                                                this
                                                                                                    .props
                                                                                                    .incidentRequest
                                                                                                    .requesting) ||
                                                                                                (this
                                                                                                    .props
                                                                                                    .multipleIncidentRequest &&
                                                                                                    this
                                                                                                        .props
                                                                                                        .multipleIncidentRequest
                                                                                                        .requesting) ||
                                                                                                (this
                                                                                                    .props
                                                                                                    .incidentRequest &&
                                                                                                    this
                                                                                                        .props
                                                                                                        .incidentRequest
                                                                                                        .resolving) ||
                                                                                                (this
                                                                                                    .props
                                                                                                    .multipleIncidentRequest &&
                                                                                                    this
                                                                                                        .props
                                                                                                        .multipleIncidentRequest
                                                                                                        .resolving)) &&
                                                                                            this
                                                                                                .state
                                                                                                .value ===
                                                                                                2
                                                                                        }
                                                                                    >
                                                                                        <Spinner
                                                                                            style={{
                                                                                                stroke:
                                                                                                    '#000000',
                                                                                            }}
                                                                                        />
                                                                                    </ShouldRender>
                                                                                    {this
                                                                                        .state
                                                                                        .resolveLoad ? null : this
                                                                                          .props
                                                                                          .incident
                                                                                          .acknowledged &&
                                                                                      !this
                                                                                          .props
                                                                                          .incident
                                                                                          .resolved &&
                                                                                      !this
                                                                                          .state
                                                                                          .resolveLoad &&
                                                                                      this
                                                                                          .state
                                                                                          .value !==
                                                                                          2 ? (
                                                                                        <div className="bs-ticks"></div>
                                                                                    ) : null}
                                                                                    <span>
                                                                                        Resolve
                                                                                        Incident
                                                                                    </span>
                                                                                </button>
                                                                                <p className="bs-Fieldset-explanation">
                                                                                    <span>
                                                                                        Let
                                                                                        your
                                                                                        team
                                                                                        know
                                                                                        you&#39;ve
                                                                                        fixed
                                                                                        this
                                                                                        incident.
                                                                                    </span>
                                                                                </p>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <div className="bs-content bs-margin-top">
                                                                <div className="bs-content-inside">
                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper">
                                                                            <span>
                                                                                Not
                                                                                Resolved
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="bs-right-side">
                                                    {this.props.incident
                                                        .title && (
                                                        <div className="bs-content bs-title">
                                                            <label className="">
                                                                Title
                                                            </label>

                                                            <ShouldRender
                                                                if={
                                                                    this.state
                                                                        .firstVisibility
                                                                }
                                                            >
                                                                <div
                                                                    className="bs-content-inside"
                                                                    onMouseEnter={() =>
                                                                        this.setState(
                                                                            {
                                                                                firstHover: {
                                                                                    display:
                                                                                        'inline',
                                                                                },
                                                                            }
                                                                        )
                                                                    }
                                                                    onMouseLeave={() =>
                                                                        this.setState(
                                                                            {
                                                                                firstHover: {
                                                                                    display:
                                                                                        'none',
                                                                                },
                                                                            }
                                                                        )
                                                                    }
                                                                >
                                                                    <span
                                                                        className="value"
                                                                        onClick={
                                                                            this
                                                                                .props
                                                                                .editable
                                                                                ? this
                                                                                      .firstIconClick
                                                                                : null
                                                                        }
                                                                        style={{
                                                                            cursor: this
                                                                                .props
                                                                                .editable
                                                                                ? 'pointer'
                                                                                : null,
                                                                        }}
                                                                    >
                                                                        {
                                                                            this
                                                                                .props
                                                                                .incident
                                                                                .title
                                                                        }
                                                                    </span>{' '}
                                                                    <ShouldRender
                                                                        if={
                                                                            this
                                                                                .props
                                                                                .editable
                                                                        }
                                                                    >
                                                                        <span
                                                                            onClick={
                                                                                this
                                                                                    .firstIconClick
                                                                            }
                                                                        >
                                                                            <img
                                                                                style={
                                                                                    this
                                                                                        .state
                                                                                        .firstHover
                                                                                }
                                                                                className="incidentEditIcon"
                                                                                alt=""
                                                                                src={
                                                                                    'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6c3ZnanM9Imh0dHA6Ly9zdmdqcy5jb20vc3ZnanMiIHZlcnNpb249IjEuMSIgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHg9IjAiIHk9IjAiIHZpZXdCb3g9IjAgMCA0MDEuNTIyODkgNDAxIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyIiB4bWw6c3BhY2U9InByZXNlcnZlIiBjbGFzcz0iIj48Zz48cGF0aCB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGQ9Im0zNzAuNTg5ODQ0IDI1MC45NzI2NTZjLTUuNTIzNDM4IDAtMTAgNC40NzY1NjMtMTAgMTB2ODguNzg5MDYzYy0uMDE5NTMyIDE2LjU2MjUtMTMuNDM3NSAyOS45ODQzNzUtMzAgMzBoLTI4MC41ODk4NDRjLTE2LjU2MjUtLjAxNTYyNS0yOS45ODA0NjktMTMuNDM3NS0zMC0zMHYtMjYwLjU4OTg0NGMuMDE5NTMxLTE2LjU1ODU5NCAxMy40Mzc1LTI5Ljk4MDQ2OSAzMC0zMGg4OC43ODkwNjJjNS41MjM0MzggMCAxMC00LjQ3NjU2MyAxMC0xMCAwLTUuNTE5NTMxLTQuNDc2NTYyLTEwLTEwLTEwaC04OC43ODkwNjJjLTI3LjYwMTU2Mi4wMzEyNS00OS45Njg3NSAyMi4zOTg0MzctNTAgNTB2MjYwLjU5Mzc1Yy4wMzEyNSAyNy42MDE1NjMgMjIuMzk4NDM4IDQ5Ljk2ODc1IDUwIDUwaDI4MC41ODk4NDRjMjcuNjAxNTYyLS4wMzEyNSA0OS45Njg3NS0yMi4zOTg0MzcgNTAtNTB2LTg4Ljc5Mjk2OWMwLTUuNTIzNDM3LTQuNDc2NTYzLTEwLTEwLTEwem0wIDAiIGZpbGw9IiM5ZjljOWMiIGRhdGEtb3JpZ2luYWw9IiMwMDAwMDAiIHN0eWxlPSIiLz48cGF0aCB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGQ9Im0zNzYuNjI4OTA2IDEzLjQ0MTQwNmMtMTcuNTc0MjE4LTE3LjU3NDIxOC00Ni4wNjY0MDYtMTcuNTc0MjE4LTYzLjY0MDYyNSAwbC0xNzguNDA2MjUgMTc4LjQwNjI1Yy0xLjIyMjY1NiAxLjIyMjY1Ni0yLjEwNTQ2OSAyLjczODI4Mi0yLjU2NjQwNiA0LjQwMjM0NGwtMjMuNDYwOTM3IDg0LjY5OTIxOWMtLjk2NDg0NCAzLjQ3MjY1Ni4wMTU2MjQgNy4xOTE0MDYgMi41NjI1IDkuNzQyMTg3IDIuNTUwNzgxIDIuNTQ2ODc1IDYuMjY5NTMxIDMuNTI3MzQ0IDkuNzQyMTg3IDIuNTY2NDA2bDg0LjY5OTIxOS0yMy40NjQ4NDNjMS42NjQwNjItLjQ2MDkzOCAzLjE3OTY4Ny0xLjM0Mzc1IDQuNDAyMzQ0LTIuNTY2NDA3bDE3OC40MDIzNDMtMTc4LjQxMDE1NmMxNy41NDY4NzUtMTcuNTg1OTM3IDE3LjU0Njg3NS00Ni4wNTQ2ODcgMC02My42NDA2MjV6bS0yMjAuMjU3ODEyIDE4NC45MDYyNSAxNDYuMDExNzE4LTE0Ni4wMTU2MjUgNDcuMDg5ODQ0IDQ3LjA4OTg0NC0xNDYuMDE1NjI1IDE0Ni4wMTU2MjV6bS05LjQwNjI1IDE4Ljg3NSAzNy42MjEwOTQgMzcuNjI1LTUyLjAzOTA2MyAxNC40MTc5Njl6bTIyNy4yNTc4MTItMTQyLjU0Njg3NS0xMC42MDU0NjggMTAuNjA1NDY5LTQ3LjA5Mzc1LTQ3LjA5Mzc1IDEwLjYwOTM3NC0xMC42MDU0NjljOS43NjE3MTktOS43NjE3MTkgMjUuNTg5ODQ0LTkuNzYxNzE5IDM1LjM1MTU2MyAwbDExLjczODI4MSAxMS43MzQzNzVjOS43NDYwOTQgOS43NzM0MzggOS43NDYwOTQgMjUuNTg5ODQ0IDAgMzUuMzU5Mzc1em0wIDAiIGZpbGw9IiM5ZjljOWMiIGRhdGEtb3JpZ2luYWw9IiMwMDAwMDAiIHN0eWxlPSIiLz48L2c+PC9zdmc+Cg=='
                                                                                }
                                                                            />
                                                                        </span>
                                                                    </ShouldRender>
                                                                </div>
                                                            </ShouldRender>
                                                            <ShouldRender
                                                                if={
                                                                    !this.state
                                                                        .firstVisibility
                                                                }
                                                            >
                                                                <form
                                                                    onSubmit={this.props.handleSubmit(
                                                                        this.firstFormSubmit.bind(
                                                                            this
                                                                        )
                                                                    )}
                                                                    style={{
                                                                        marginTop:
                                                                            '3px',
                                                                        marginLeft:
                                                                            '-3px',
                                                                    }}
                                                                >
                                                                    <div className="bs-Fieldset-fields">
                                                                        <Field
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            component={
                                                                                RenderField
                                                                            }
                                                                            name="title"
                                                                            disabled={
                                                                                false
                                                                            }
                                                                            validate={[
                                                                                ValidateField.required,
                                                                            ]}
                                                                            style={{
                                                                                width: 212,
                                                                            }}
                                                                            onBlur={this.props.handleSubmit(
                                                                                this
                                                                                    .firstFormSubmit
                                                                            )}
                                                                            id="title"
                                                                        />
                                                                    </div>
                                                                </form>
                                                            </ShouldRender>
                                                        </div>
                                                    )}
                                                    {this.props.incident
                                                        .description && (
                                                        <div className="bs-content">
                                                            <label className="">
                                                                Description
                                                            </label>
                                                            <ShouldRender
                                                                if={
                                                                    this.state
                                                                        .secondVisibility
                                                                }
                                                            >
                                                                <div
                                                                    className="bs-content-inside"
                                                                    onMouseEnter={() =>
                                                                        this.setState(
                                                                            {
                                                                                secondHover: {
                                                                                    display:
                                                                                        'inline',
                                                                                },
                                                                            }
                                                                        )
                                                                    }
                                                                    onMouseLeave={() =>
                                                                        this.setState(
                                                                            {
                                                                                secondHover: {
                                                                                    display:
                                                                                        'none',
                                                                                },
                                                                            }
                                                                        )
                                                                    }
                                                                >
                                                                    <p
                                                                        onClick={
                                                                            this
                                                                                .props
                                                                                .editable
                                                                                ? this
                                                                                      .secondIconClick
                                                                                : null
                                                                        }
                                                                        style={{
                                                                            display:
                                                                                'inline',
                                                                            wordBreak:
                                                                                'break-word',
                                                                            cursor: this
                                                                                .props
                                                                                .editable
                                                                                ? 'pointer'
                                                                                : null,
                                                                        }}
                                                                    >
                                                                        {
                                                                            this
                                                                                .props
                                                                                .incident
                                                                                .description
                                                                        }
                                                                    </p>{' '}
                                                                    <ShouldRender
                                                                        if={
                                                                            this
                                                                                .props
                                                                                .editable
                                                                        }
                                                                    >
                                                                        <span
                                                                            onClick={
                                                                                this
                                                                                    .secondIconClick
                                                                            }
                                                                        >
                                                                            <img
                                                                                style={
                                                                                    this
                                                                                        .state
                                                                                        .secondHover
                                                                                }
                                                                                className="incidentEditIcon"
                                                                                alt=""
                                                                                src={
                                                                                    'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6c3ZnanM9Imh0dHA6Ly9zdmdqcy5jb20vc3ZnanMiIHZlcnNpb249IjEuMSIgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHg9IjAiIHk9IjAiIHZpZXdCb3g9IjAgMCA0MDEuNTIyODkgNDAxIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyIiB4bWw6c3BhY2U9InByZXNlcnZlIiBjbGFzcz0iIj48Zz48cGF0aCB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGQ9Im0zNzAuNTg5ODQ0IDI1MC45NzI2NTZjLTUuNTIzNDM4IDAtMTAgNC40NzY1NjMtMTAgMTB2ODguNzg5MDYzYy0uMDE5NTMyIDE2LjU2MjUtMTMuNDM3NSAyOS45ODQzNzUtMzAgMzBoLTI4MC41ODk4NDRjLTE2LjU2MjUtLjAxNTYyNS0yOS45ODA0NjktMTMuNDM3NS0zMC0zMHYtMjYwLjU4OTg0NGMuMDE5NTMxLTE2LjU1ODU5NCAxMy40Mzc1LTI5Ljk4MDQ2OSAzMC0zMGg4OC43ODkwNjJjNS41MjM0MzggMCAxMC00LjQ3NjU2MyAxMC0xMCAwLTUuNTE5NTMxLTQuNDc2NTYyLTEwLTEwLTEwaC04OC43ODkwNjJjLTI3LjYwMTU2Mi4wMzEyNS00OS45Njg3NSAyMi4zOTg0MzctNTAgNTB2MjYwLjU5Mzc1Yy4wMzEyNSAyNy42MDE1NjMgMjIuMzk4NDM4IDQ5Ljk2ODc1IDUwIDUwaDI4MC41ODk4NDRjMjcuNjAxNTYyLS4wMzEyNSA0OS45Njg3NS0yMi4zOTg0MzcgNTAtNTB2LTg4Ljc5Mjk2OWMwLTUuNTIzNDM3LTQuNDc2NTYzLTEwLTEwLTEwem0wIDAiIGZpbGw9IiM5ZjljOWMiIGRhdGEtb3JpZ2luYWw9IiMwMDAwMDAiIHN0eWxlPSIiLz48cGF0aCB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGQ9Im0zNzYuNjI4OTA2IDEzLjQ0MTQwNmMtMTcuNTc0MjE4LTE3LjU3NDIxOC00Ni4wNjY0MDYtMTcuNTc0MjE4LTYzLjY0MDYyNSAwbC0xNzguNDA2MjUgMTc4LjQwNjI1Yy0xLjIyMjY1NiAxLjIyMjY1Ni0yLjEwNTQ2OSAyLjczODI4Mi0yLjU2NjQwNiA0LjQwMjM0NGwtMjMuNDYwOTM3IDg0LjY5OTIxOWMtLjk2NDg0NCAzLjQ3MjY1Ni4wMTU2MjQgNy4xOTE0MDYgMi41NjI1IDkuNzQyMTg3IDIuNTUwNzgxIDIuNTQ2ODc1IDYuMjY5NTMxIDMuNTI3MzQ0IDkuNzQyMTg3IDIuNTY2NDA2bDg0LjY5OTIxOS0yMy40NjQ4NDNjMS42NjQwNjItLjQ2MDkzOCAzLjE3OTY4Ny0xLjM0Mzc1IDQuNDAyMzQ0LTIuNTY2NDA3bDE3OC40MDIzNDMtMTc4LjQxMDE1NmMxNy41NDY4NzUtMTcuNTg1OTM3IDE3LjU0Njg3NS00Ni4wNTQ2ODcgMC02My42NDA2MjV6bS0yMjAuMjU3ODEyIDE4NC45MDYyNSAxNDYuMDExNzE4LTE0Ni4wMTU2MjUgNDcuMDg5ODQ0IDQ3LjA4OTg0NC0xNDYuMDE1NjI1IDE0Ni4wMTU2MjV6bS05LjQwNjI1IDE4Ljg3NSAzNy42MjEwOTQgMzcuNjI1LTUyLjAzOTA2MyAxNC40MTc5Njl6bTIyNy4yNTc4MTItMTQyLjU0Njg3NS0xMC42MDU0NjggMTAuNjA1NDY5LTQ3LjA5Mzc1LTQ3LjA5Mzc1IDEwLjYwOTM3NC0xMC42MDU0NjljOS43NjE3MTktOS43NjE3MTkgMjUuNTg5ODQ0LTkuNzYxNzE5IDM1LjM1MTU2MyAwbDExLjczODI4MSAxMS43MzQzNzVjOS43NDYwOTQgOS43NzM0MzggOS43NDYwOTQgMjUuNTg5ODQ0IDAgMzUuMzU5Mzc1em0wIDAiIGZpbGw9IiM5ZjljOWMiIGRhdGEtb3JpZ2luYWw9IiMwMDAwMDAiIHN0eWxlPSIiLz48L2c+PC9zdmc+Cg=='
                                                                                }
                                                                            />
                                                                        </span>
                                                                    </ShouldRender>
                                                                </div>
                                                            </ShouldRender>
                                                            <ShouldRender
                                                                if={
                                                                    !this.state
                                                                        .secondVisibility
                                                                }
                                                            >
                                                                <form
                                                                    onSubmit={this.props.handleSubmit(
                                                                        this.secondFormSubmit.bind(
                                                                            this
                                                                        )
                                                                    )}
                                                                    style={{
                                                                        marginTop:
                                                                            '3px',
                                                                        marginLeft:
                                                                            '-3px',
                                                                    }}
                                                                >
                                                                    <div className="bs-Fieldset-fields">
                                                                        <Field
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            component={
                                                                                RenderCodeEditor
                                                                            }
                                                                            name="description"
                                                                            readOnly={
                                                                                false
                                                                            }
                                                                            required={
                                                                                true
                                                                            }
                                                                            wrapEnabled={
                                                                                true
                                                                            }
                                                                            mode="markdown"
                                                                            height="125px"
                                                                            width="100%"
                                                                            placeholder="Please add a description"
                                                                            onBlur={
                                                                                this
                                                                                    .secondFormSubmit
                                                                            }
                                                                            id="description"
                                                                        />
                                                                    </div>
                                                                </form>
                                                            </ShouldRender>
                                                        </div>
                                                    )}
                                                    {this.props.incident
                                                        .manuallyCreated &&
                                                        this.props.incident
                                                            .createdById && (
                                                            <div className="bs-content">
                                                                <label className="">
                                                                    Cause
                                                                </label>
                                                                <div className="bs-content-inside">
                                                                    <div className="bs-flex-display bs-display-block">
                                                                        <span>
                                                                            This
                                                                            incident
                                                                            was
                                                                            created
                                                                            by
                                                                        </span>
                                                                        <Link
                                                                            style={{
                                                                                textDecoration:
                                                                                    'underline',
                                                                                marginLeft:
                                                                                    '4px',
                                                                            }}
                                                                            to={
                                                                                '/dashboard/profile/' +
                                                                                this
                                                                                    .props
                                                                                    .incident
                                                                                    .createdById
                                                                                    ._id
                                                                            }
                                                                        >
                                                                            <div>
                                                                                {
                                                                                    this
                                                                                        .props
                                                                                        .incident
                                                                                        .createdById
                                                                                        .name
                                                                                }
                                                                            </div>
                                                                        </Link>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    {this.props.incident
                                                        .incidentType &&
                                                        this.props.incident
                                                            .reason && (
                                                            <div className="bs-content">
                                                                <label className="">
                                                                    Cause
                                                                </label>
                                                                <div
                                                                    className="bs-content-inside"
                                                                    id={`${monitorName}_IncidentReport_${this.props.count}`}
                                                                >
                                                                    <ReactMarkdown
                                                                        source={`${
                                                                            incidentReason &&
                                                                            incidentReason.length >
                                                                                1
                                                                                ? incidentReason
                                                                                      .map(
                                                                                          a => {
                                                                                              if (
                                                                                                  a.includes(
                                                                                                      'Response Time'
                                                                                                  )
                                                                                              ) {
                                                                                                  const milliSeconds = a.match(
                                                                                                      /\d+/
                                                                                                  )[0];
                                                                                                  const time = formatMonitorResponseTime(
                                                                                                      Number(
                                                                                                          milliSeconds
                                                                                                      )
                                                                                                  );
                                                                                                  return (
                                                                                                      '- **&middot; ' +
                                                                                                      a.replace(
                                                                                                          milliSeconds +
                                                                                                              ' ms',
                                                                                                          time
                                                                                                      ) +
                                                                                                      '**.'
                                                                                                  );
                                                                                              } else {
                                                                                                  return (
                                                                                                      '- **&middot; ' +
                                                                                                      a +
                                                                                                      '**.'
                                                                                                  );
                                                                                              }
                                                                                          }
                                                                                      )
                                                                                      .join(
                                                                                          '\n'
                                                                                      )
                                                                                : incidentReason.map(
                                                                                      a => {
                                                                                          if (
                                                                                              a.includes(
                                                                                                  'Response Time'
                                                                                              )
                                                                                          ) {
                                                                                              const milliSeconds = a.match(
                                                                                                  /\d+/
                                                                                              )[0];
                                                                                              const time = formatMonitorResponseTime(
                                                                                                  Number(
                                                                                                      milliSeconds
                                                                                                  )
                                                                                              );
                                                                                              return (
                                                                                                  ' **' +
                                                                                                  a.replace(
                                                                                                      milliSeconds +
                                                                                                          ' ms',
                                                                                                      time
                                                                                                  ) +
                                                                                                  '**.'
                                                                                              );
                                                                                          } else {
                                                                                              return (
                                                                                                  ' **' +
                                                                                                  a +
                                                                                                  '**.'
                                                                                              );
                                                                                          }
                                                                                      }
                                                                                  )
                                                                        }`}
                                                                    />
                                                                </div>
                                                                {this.props
                                                                    .incident
                                                                    .response &&
                                                                    this.props
                                                                        .incident
                                                                        .reason && (
                                                                        <button
                                                                            id={`${monitorName}_ShowResponse_${this.props.count}`}
                                                                            title="Show Response Body"
                                                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton Flex-flex"
                                                                            type="button"
                                                                            onClick={() =>
                                                                                this.props.openModal(
                                                                                    {
                                                                                        id: this
                                                                                            .state
                                                                                            .viewJsonModalId,
                                                                                        content: DataPathHoC(
                                                                                            ViewJsonLogs,
                                                                                            {
                                                                                                viewJsonModalId: this
                                                                                                    .state
                                                                                                    .viewJsonModalId,
                                                                                                jsonLog: this
                                                                                                    .props
                                                                                                    .incident
                                                                                                    .response,
                                                                                                title:
                                                                                                    'API Response',
                                                                                                rootName:
                                                                                                    'response',
                                                                                            }
                                                                                        ),
                                                                                    }
                                                                                )
                                                                            }
                                                                        >
                                                                            <span>
                                                                                Show
                                                                                Response
                                                                                Body
                                                                            </span>
                                                                        </button>
                                                                    )}
                                                            </div>
                                                        )}

                                                    {this.props.incident
                                                        .criterionCause &&
                                                        this.props.incident
                                                            .criterionCause
                                                            .name && (
                                                            <div className="bs-content">
                                                                <label className="">
                                                                    Criterion
                                                                </label>
                                                                <div className="bs-content-inside">
                                                                    {`${this.props.incident.criterionCause.name}`}
                                                                </div>
                                                            </div>
                                                        )}

                                                    {this.props.incident
                                                        .incidentPriority && (
                                                        <div className="bs-content">
                                                            <label className="">
                                                                Priority
                                                            </label>
                                                            <div className="bs-content-inside">
                                                                <ShouldRender
                                                                    if={
                                                                        this
                                                                            .state
                                                                            .thirdVisibility
                                                                    }
                                                                >
                                                                    <div className="Flex-flex Flex-alignItems--center bs-justify-cont">
                                                                        <span
                                                                            className="Margin-right--4"
                                                                            style={{
                                                                                display:
                                                                                    'inline',
                                                                                backgroundColor: `rgba(${this.props.incident.incidentPriority.color.r},${this.props.incident.incidentPriority.color.g},${this.props.incident.incidentPriority.color.b},${this.props.incident.incidentPriority.color.a})`,
                                                                                height:
                                                                                    '15px',
                                                                                width:
                                                                                    '15px',
                                                                                borderRadius:
                                                                                    '30%',
                                                                            }}
                                                                        ></span>
                                                                        <span
                                                                            onMouseEnter={() =>
                                                                                this.setState(
                                                                                    {
                                                                                        thirdHover: {
                                                                                            display:
                                                                                                'inline',
                                                                                        },
                                                                                    }
                                                                                )
                                                                            }
                                                                            onMouseLeave={() =>
                                                                                this.setState(
                                                                                    {
                                                                                        thirdHover: {
                                                                                            display:
                                                                                                'none',
                                                                                        },
                                                                                    }
                                                                                )
                                                                            }
                                                                        >
                                                                            <span
                                                                                onClick={
                                                                                    this
                                                                                        .props
                                                                                        .editable
                                                                                        ? this
                                                                                              .thirdIconClick
                                                                                        : null
                                                                                }
                                                                                className="Text-fontWeight--medium"
                                                                                style={{
                                                                                    color: `rgba(${this.props.incident.incidentPriority.color.r},${this.props.incident.incidentPriority.color.g},${this.props.incident.incidentPriority.color.b},${this.props.incident.incidentPriority.color.a})`,
                                                                                    cursor: this
                                                                                        .props
                                                                                        .editable
                                                                                        ? 'pointer'
                                                                                        : null,
                                                                                }}
                                                                            >
                                                                                {
                                                                                    this
                                                                                        .props
                                                                                        .incident
                                                                                        .incidentPriority
                                                                                        .name
                                                                                }
                                                                            </span>{' '}
                                                                            <ShouldRender
                                                                                if={
                                                                                    this
                                                                                        .props
                                                                                        .editable
                                                                                }
                                                                            >
                                                                                <span
                                                                                    onClick={
                                                                                        this
                                                                                            .thirdIconClick
                                                                                    }
                                                                                >
                                                                                    <img
                                                                                        style={
                                                                                            this
                                                                                                .state
                                                                                                .thirdHover
                                                                                        }
                                                                                        className="incidentEditIcon"
                                                                                        alt=""
                                                                                        src={
                                                                                            'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6c3ZnanM9Imh0dHA6Ly9zdmdqcy5jb20vc3ZnanMiIHZlcnNpb249IjEuMSIgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHg9IjAiIHk9IjAiIHZpZXdCb3g9IjAgMCA0MDEuNTIyODkgNDAxIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyIiB4bWw6c3BhY2U9InByZXNlcnZlIiBjbGFzcz0iIj48Zz48cGF0aCB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGQ9Im0zNzAuNTg5ODQ0IDI1MC45NzI2NTZjLTUuNTIzNDM4IDAtMTAgNC40NzY1NjMtMTAgMTB2ODguNzg5MDYzYy0uMDE5NTMyIDE2LjU2MjUtMTMuNDM3NSAyOS45ODQzNzUtMzAgMzBoLTI4MC41ODk4NDRjLTE2LjU2MjUtLjAxNTYyNS0yOS45ODA0NjktMTMuNDM3NS0zMC0zMHYtMjYwLjU4OTg0NGMuMDE5NTMxLTE2LjU1ODU5NCAxMy40Mzc1LTI5Ljk4MDQ2OSAzMC0zMGg4OC43ODkwNjJjNS41MjM0MzggMCAxMC00LjQ3NjU2MyAxMC0xMCAwLTUuNTE5NTMxLTQuNDc2NTYyLTEwLTEwLTEwaC04OC43ODkwNjJjLTI3LjYwMTU2Mi4wMzEyNS00OS45Njg3NSAyMi4zOTg0MzctNTAgNTB2MjYwLjU5Mzc1Yy4wMzEyNSAyNy42MDE1NjMgMjIuMzk4NDM4IDQ5Ljk2ODc1IDUwIDUwaDI4MC41ODk4NDRjMjcuNjAxNTYyLS4wMzEyNSA0OS45Njg3NS0yMi4zOTg0MzcgNTAtNTB2LTg4Ljc5Mjk2OWMwLTUuNTIzNDM3LTQuNDc2NTYzLTEwLTEwLTEwem0wIDAiIGZpbGw9IiM5ZjljOWMiIGRhdGEtb3JpZ2luYWw9IiMwMDAwMDAiIHN0eWxlPSIiLz48cGF0aCB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGQ9Im0zNzYuNjI4OTA2IDEzLjQ0MTQwNmMtMTcuNTc0MjE4LTE3LjU3NDIxOC00Ni4wNjY0MDYtMTcuNTc0MjE4LTYzLjY0MDYyNSAwbC0xNzguNDA2MjUgMTc4LjQwNjI1Yy0xLjIyMjY1NiAxLjIyMjY1Ni0yLjEwNTQ2OSAyLjczODI4Mi0yLjU2NjQwNiA0LjQwMjM0NGwtMjMuNDYwOTM3IDg0LjY5OTIxOWMtLjk2NDg0NCAzLjQ3MjY1Ni4wMTU2MjQgNy4xOTE0MDYgMi41NjI1IDkuNzQyMTg3IDIuNTUwNzgxIDIuNTQ2ODc1IDYuMjY5NTMxIDMuNTI3MzQ0IDkuNzQyMTg3IDIuNTY2NDA2bDg0LjY5OTIxOS0yMy40NjQ4NDNjMS42NjQwNjItLjQ2MDkzOCAzLjE3OTY4Ny0xLjM0Mzc1IDQuNDAyMzQ0LTIuNTY2NDA3bDE3OC40MDIzNDMtMTc4LjQxMDE1NmMxNy41NDY4NzUtMTcuNTg1OTM3IDE3LjU0Njg3NS00Ni4wNTQ2ODcgMC02My42NDA2MjV6bS0yMjAuMjU3ODEyIDE4NC45MDYyNSAxNDYuMDExNzE4LTE0Ni4wMTU2MjUgNDcuMDg5ODQ0IDQ3LjA4OTg0NC0xNDYuMDE1NjI1IDE0Ni4wMTU2MjV6bS05LjQwNjI1IDE4Ljg3NSAzNy42MjEwOTQgMzcuNjI1LTUyLjAzOTA2MyAxNC40MTc5Njl6bTIyNy4yNTc4MTItMTQyLjU0Njg3NS0xMC42MDU0NjggMTAuNjA1NDY5LTQ3LjA5Mzc1LTQ3LjA5Mzc1IDEwLjYwOTM3NC0xMC42MDU0NjljOS43NjE3MTktOS43NjE3MTkgMjUuNTg5ODQ0LTkuNzYxNzE5IDM1LjM1MTU2MyAwbDExLjczODI4MSAxMS43MzQzNzVjOS43NDYwOTQgOS43NzM0MzggOS43NDYwOTQgMjUuNTg5ODQ0IDAgMzUuMzU5Mzc1em0wIDAiIGZpbGw9IiM5ZjljOWMiIGRhdGEtb3JpZ2luYWw9IiMwMDAwMDAiIHN0eWxlPSIiLz48L2c+PC9zdmc+Cg=='
                                                                                        }
                                                                                    />
                                                                                </span>
                                                                            </ShouldRender>
                                                                        </span>
                                                                    </div>
                                                                </ShouldRender>
                                                                <ShouldRender
                                                                    if={
                                                                        !this
                                                                            .state
                                                                            .thirdVisibility
                                                                    }
                                                                >
                                                                    <form
                                                                        onSubmit={this.props.handleSubmit(
                                                                            this.thirdFormSubmit.bind(
                                                                                this
                                                                            )
                                                                        )}
                                                                    >
                                                                        <div
                                                                            className="bs-Fieldset-fields"
                                                                            style={{
                                                                                marginTop: 2,
                                                                            }}
                                                                        >
                                                                            <div>
                                                                                <Field
                                                                                    className="db-select-nw"
                                                                                    component={
                                                                                        RenderSelect
                                                                                    }
                                                                                    name="incidentPriority"
                                                                                    disabled={
                                                                                        false
                                                                                    }
                                                                                    id="incidentPriority"
                                                                                    options={[
                                                                                        ...this.props.incidentPriorities.map(
                                                                                            incidentPriority => ({
                                                                                                value:
                                                                                                    incidentPriority._id,
                                                                                                label:
                                                                                                    incidentPriority.name,
                                                                                            })
                                                                                        ),
                                                                                    ]}
                                                                                    onChange={
                                                                                        this
                                                                                            .thirdFormSubmit
                                                                                    }
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </form>
                                                                </ShouldRender>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {this.props.incident
                                                        .customFields &&
                                                        this.props.incident
                                                            .customFields
                                                            .length > 0 &&
                                                        this.props.incident.customFields.map(
                                                            (field, index) => (
                                                                <div
                                                                    className="bs-content"
                                                                    key={index}
                                                                >
                                                                    <label>
                                                                        {
                                                                            field.fieldName
                                                                        }
                                                                    </label>
                                                                    <div className="bs-content-inside">
                                                                        <span className="value">
                                                                            {field.fieldValue ||
                                                                            (typeof field.fieldValue ===
                                                                                'string' &&
                                                                                !!field.fieldValue.trim())
                                                                                ? field.fieldValue
                                                                                : '-'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )
                                                        )}
                                                    {team && team.length > 0 && (
                                                        <div className="bs-content">
                                                            <label className="">
                                                                Members on Call
                                                                Duty
                                                            </label>
                                                            <div className="bs-content-inside">
                                                                {team.map(
                                                                    member => (
                                                                        <div
                                                                            className="Box-root Margin-right--16 pointer"
                                                                            key={
                                                                                member
                                                                                    .user
                                                                                    ._id
                                                                            }
                                                                        >
                                                                            <img
                                                                                src="/dashboard/assets/img/profile-user.svg"
                                                                                className="userIcon"
                                                                                alt=""
                                                                            />
                                                                            <span>
                                                                                {member
                                                                                    .user
                                                                                    .name ??
                                                                                    member
                                                                                        .user
                                                                                        .email}
                                                                            </span>
                                                                        </div>
                                                                    )
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>

                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--flexEnd Padding-horizontal--20 Padding-bottom--12">
                                <ShouldRender
                                    if={
                                        this.props.route &&
                                        !(this.props.route === incidentRoute)
                                    }
                                >
                                    <button
                                        className="bs-Button bs-Button--more bs-btn-extra"
                                        id={`${monitorName}_ViewIncidentDetails`}
                                        type="button"
                                        onClick={() => {
                                            setTimeout(() => {
                                                history.push(
                                                    `/dashboard/project/${this.props.currentProject.slug}/${componentId}/incidents/${incidentId}`
                                                );
                                                this.props.animateSidebar(
                                                    false
                                                );
                                            }, 200);
                                            this.props.markAsRead(
                                                projectId,
                                                this.props.incident
                                                    .notificationId
                                            );
                                            this.props.animateSidebar(true);
                                        }}
                                    >
                                        <span>View Incident</span>
                                    </button>
                                </ShouldRender>
                                <FooterButton
                                    className={
                                        this.props.incident.acknowledged &&
                                        this.props.incident.resolved
                                            ? 'bs-btn-extra bs-Button bs-flex-display bs-remove-shadow'
                                            : 'bs-btn-extra bs-Button bs-flex-display'
                                    }
                                    id={`${monitorName}_EditIncidentDetails_${this.props.count}`}
                                    type="button"
                                    onClick={setLoading =>
                                        this.handleIncident(
                                            undefined,
                                            false,
                                            setLoading
                                        )
                                    }
                                    acknowledged={
                                        this.props.incident.acknowledged
                                    }
                                    resolved={this.props.incident.resolved}
                                    route={this.props.route}
                                    homeRoute={homeRoute}
                                    monitorRoute={monitorRoute}
                                    state={this.state}
                                    incidentRequest={this.props.incidentRequest}
                                    multipleIncidentRequest={
                                        this.props.multipleIncidentRequest
                                    }
                                />
                                <ShouldRender
                                    if={
                                        this.props.multiple &&
                                        this.props.incident &&
                                        this.props.incident.acknowledged &&
                                        this.props.incident.resolved
                                    }
                                >
                                    <button
                                        onClick={() => {
                                            this.props.incident.resolved
                                                ? this.closeIncident()
                                                : this.props.openModal({
                                                      id: this.state
                                                          .messageModalId,
                                                      onClose: () => '',
                                                      content: DataPathHoC(
                                                          MessageBox,
                                                          {
                                                              messageBoxId: this
                                                                  .state
                                                                  .messageModalId,
                                                              title: 'Warning',
                                                              message:
                                                                  'This incident cannot be closed because it is not acknowledged or resolved',
                                                          }
                                                      ),
                                                  });
                                        }}
                                        className={
                                            this.props.closeincident &&
                                            this.props.closeincident
                                                .requesting &&
                                            this.props.closeincident
                                                .requesting ===
                                                this.props.incident._id
                                                ? 'bs-Button bs-Button--blue bs-btn-extra'
                                                : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-btn-extra'
                                        }
                                        disabled={
                                            this.props.closeincident &&
                                            this.props.closeincident
                                                .requesting &&
                                            this.props.closeincident
                                                .requesting ===
                                                this.props.incident._id
                                        }
                                        type="button"
                                        id={`closeIncidentButton_${this.props.count}`}
                                        style={{ marginLeft: '-16px' }}
                                    >
                                        <ShouldRender
                                            if={
                                                this.props.closeincident &&
                                                this.props.closeincident
                                                    .requesting &&
                                                this.props.closeincident
                                                    .requesting ===
                                                    this.props.incident._id
                                            }
                                        >
                                            <FormLoader />
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                this.props.closeincident &&
                                                (!this.props.closeincident
                                                    .requesting ||
                                                    (this.props.closeincident
                                                        .requesting &&
                                                        this.props.closeincident
                                                            .requesting !==
                                                            this.props.incident
                                                                ._id))
                                            }
                                        >
                                            <span>Close</span>
                                        </ShouldRender>
                                    </button>
                                </ShouldRender>
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    }
}

IncidentStatus.displayName = 'IncidentStatus';

const EditIncidentStatusForm = reduxForm({
    form: 'IncidentStatusForm',
    enableReinitialize: true,
})(IncidentStatus);
const selector = formValueSelector('IncidentStatusForm');
const mapStateToProps = (state, ownProps) => {
    const incident = ownProps.incident;
    const initialValues = {
        title: incident.title,
        description: incident.description,
        incidentPriority: incident.incidentPriority._id,
    };
    const { description, incidentPriority } = selector(
        state,
        'description',
        'incidentPriority'
    );
    return {
        currentProject: state.project.currentProject,
        closeincident: state.incident.closeincident,
        subProjects: state.subProject.subProjects.subProjects,
        incidentRequest: state.incident.incident,
        escalations: state.schedule.escalations,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
        initialValues,
        description,
        incidentPriority,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            resolveIncident,
            acknowledgeIncident,
            closeIncident,
            openModal,
            markAsRead,
            getIncidentTimeline,
            animateSidebar,
            updateIncident,
        },
        dispatch
    );
};

IncidentStatus.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    resolveIncident: PropTypes.func.isRequired,
    acknowledgeIncident: PropTypes.func.isRequired,
    updateIncident: PropTypes.func.isRequired,
    closeIncident: PropTypes.func,
    closeincident: PropTypes.object,
    requesting: PropTypes.bool,
    incident: PropTypes.object.isRequired,
    currentProject: PropTypes.object.isRequired,
    subProjects: PropTypes.array.isRequired,
    multiple: PropTypes.bool,
    count: PropTypes.number,
    openModal: PropTypes.func.isRequired,
    projectId: PropTypes.string,
    description: PropTypes.string,
    componentId: PropTypes.string,
    route: PropTypes.string,
    incidentRequest: PropTypes.object.isRequired,
    multipleIncidentRequest: PropTypes.object,
    markAsRead: PropTypes.func,
    getIncidentTimeline: PropTypes.func,
    animateSidebar: PropTypes.func,
    escalations: PropTypes.array,
    editable: PropTypes.bool,
    incidentPriorities: PropTypes.array.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditIncidentStatusForm);
