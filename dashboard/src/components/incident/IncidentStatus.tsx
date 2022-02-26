import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
import {
    acknowledgeIncident,
    resolveIncident,
    closeIncident,
    getIncidentTimeline,
    updateIncident,
    fetchIncidentMessages,
} from '../../actions/incident';
import { FormLoader, Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { User } from '../../config';

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
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field, formValueSelector } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import { RenderSelect } from '../basic/RenderSelect';
export class IncidentStatus extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            // editIncidentModalId: uuidv4(), unused due to code re-implementation
            messageModalId: uuidv4(),
            viewJsonModalId: uuidv4(),
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
            resolving: false,
            acknowledging: false,
        };
    }
    firstIconClick = () => {
        this.setState({
            firstVisibility: false,
        });
    };
    firstFormSubmit = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const incidentId = this.props.incident._id;
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.projectId._id ?? this.props.incident.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const incidentType = this.props.incident.incidentType;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const description = this.props.incident.description;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const incidentPriority = this.props.incident.incidentPriority._id;

        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateIncident' does not exist on type '... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const incidentId = this.props.incident._id;
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.projectId._id ?? this.props.incident.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const incidentType = this.props.incident.incidentType;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const title = this.props.incident.title;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'description' does not exist on type 'Rea... Remove this comment to see the full error message
        const description = this.props.description;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const incidentPriority = this.props.incident.incidentPriority._id;
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateIncident' does not exist on type '... Remove this comment to see the full error message
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
    thirdFormSubmit = (e: $TSFixMe, value: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const incidentId = this.props.incident._id;
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.projectId._id ?? this.props.incident.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const incidentType = this.props.incident.incidentType;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const title = this.props.incident.title;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        const description = this.props.incident.description;
        const incidentPriority = value;
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateIncident' does not exist on type '... Remove this comment to see the full error message
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
    acknowledge = async (setLoading: $TSFixMe) => {
        const userId = User.getUserId();
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.projectId._id ?? this.props.incident.projectId;

        this.setState({ acknowledging: true });

        await this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'acknowledgeIncident' does not exist on t... Remove this comment to see the full error message
            .acknowledgeIncident(
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.incident._id,
                userId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'multiple' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.multiple
            )
            .then(() => {
                this.setState({ resolveLoad: false, acknowledging: false });
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'markAsRead' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.markAsRead(
                    projectId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.incident.notifications
                );
                if (setLoading) {
                    setLoading(false);
                }
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getIncidentTimeline' does not exist on t... Remove this comment to see the full error message
                this.props.getIncidentTimeline(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.incident._id,
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                    parseInt(0),
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                    parseInt(10)
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentMessages' does not exist on... Remove this comment to see the full error message
                this.props.fetchIncidentMessages(
                    projectId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.incident.slug,
                    0,
                    10,
                    'internal'
                );
            });
    };

    resolve = async (setLoading: $TSFixMe) => {
        const userId = User.getUserId();
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.projectId._id ?? this.props.incident.projectId;

        this.setState({ resolving: true });

        await this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveIncident' does not exist on type ... Remove this comment to see the full error message
            .resolveIncident(
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.incident._id,
                userId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'multiple' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.multiple
            )
            .then(() => {
                this.setState({
                    resolveLoad: false,
                    value: '',
                    stats: false,
                    resolving: false,
                });
                if (setLoading) {
                    setLoading(false);
                }
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'markAsRead' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.markAsRead(
                    projectId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.incident.notifications
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getIncidentTimeline' does not exist on t... Remove this comment to see the full error message
                this.props.getIncidentTimeline(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.incident._id,
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                    parseInt(0),
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                    parseInt(10)
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentMessages' does not exist on... Remove this comment to see the full error message
                this.props.fetchIncidentMessages(
                    projectId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.incident.slug,
                    0,
                    10,
                    'internal'
                );
            });
    };

    closeIncident = () => {
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.projectId._id ?? this.props.incident.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeIncident' does not exist on type 'R... Remove this comment to see the full error message
        this.props.closeIncident(projectId, this.props.incident._id);
    };

    handleIncident = (value: $TSFixMe, stats: $TSFixMe, setLoading: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        if (!this.props.incident.acknowledged) {
            this.setState({ resolveLoad: true, value, stats });
            this.acknowledge(setLoading);
        } else if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.acknowledged &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            !this.props.incident.resolved
        ) {
            this.setState({ resolveLoad: true, value, stats });
            this.resolve(setLoading);
        }
    };

    getOnCallTeamMembers = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
        if (this.props.incident && this.props.incident.monitors) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            const monitors = this.props.incident.monitors.map(
                (monitor: $TSFixMe) => monitor.monitorId
            );
            const escalationArray = [];

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalations' does not exist on type 'Rea... Remove this comment to see the full error message
            const escalation = this.props.escalations
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalations' does not exist on type 'Rea... Remove this comment to see the full error message
                ? this.props.escalations.find(
                      (escalation: $TSFixMe) => escalation.scheduleId &&
                      escalation.scheduleId.isDefault
                  )
                : null;
            escalation && escalationArray.push(escalation);

            if (!escalation) {
                for (const monitorObj of monitors) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalations' does not exist on type 'Rea... Remove this comment to see the full error message
                    const foundEscalation = this.props.escalations
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalations' does not exist on type 'Rea... Remove this comment to see the full error message
                        ? this.props.escalations.find(
                              (escalation: $TSFixMe) => escalation.scheduleId &&
                              escalation.scheduleId.monitorIds &&
                              escalation.scheduleId.monitorIds.length > 0 &&
                              escalation.scheduleId.monitorIds.some(
                                  (monitor: $TSFixMe) => monitor._id === monitorObj._id
                              )
                          )
                        : null;
                    foundEscalation && escalationArray.push(foundEscalation);
                }
            }

            const teamMembers: $TSFixMe = [];
            escalationArray.forEach(escalation => {
                if (escalation && escalation.teams && escalation.teams[0]) {
                    teamMembers.push(...escalation.teams[0].teamMembers);
                }
            });

            return teamMembers;
        } else {
            return [];
        }
    };

    handleMonitorList = (monitors: $TSFixMe) => {
        if (monitors && monitors.length === 1) {
            return monitors[0].monitorId.name;
        }
        if (monitors && monitors.length === 2) {
            return `${monitors[0].monitorId.name} and ${monitors[1].monitorId.name}`;
        }
        if (monitors && monitors.length === 3) {
            return `${monitors[0].monitorId.name}, ${monitors[1].monitorId.name} and ${monitors[2].monitorId.name}`;
        }
        if (monitors && monitors.length > 3) {
            return `${monitors[0].monitorId.name}, ${
                monitors[1].monitorId.name
            } and ${monitors.length - 2} others`;
        }

        return '';
    };

    render() {
        const isUserSubProjectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.projectId &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            (this.props.incident.projectId._id ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.incident.projectId);
        const subProject =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.subProjects &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.subProjects.filter(
                (subProject: $TSFixMe) => subProject._id === isUserSubProjectId // The Id is being looked for during filtering. What it was seeing is an object that contains the ID
            )[0];

        const loggedInUser = User.getUserId();
        const isUserInProject =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject.users.some(
                (user: $TSFixMe) => user.userId === loggedInUser
            );
        let isUserInSubProject = false;
        if (isUserInProject) {
            isUserInSubProject = true;
        } else {
            isUserInSubProject = subProject.users.some(
                (user: $TSFixMe) => user.userId === loggedInUser
            );
        }

        const monitorName =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'multiple' does not exist on type 'Readon... Remove this comment to see the full error message
            (this.props.multiple &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.incident &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.incident.monitors &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                this.handleMonitorList(this.props.incident.monitors)) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            (this.props.incident && this.props.incident.monitors)
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                ? this.handleMonitorList(this.props.incident.monitors)
                : '';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const projectId = this.props.currentProject
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject._id
            : '';
        // const incidentIdNumber = this.props.incident
        //     ? this.props.incident.idNumber
        //     : '';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const homeRoute = this.props.currentProject
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? '/dashboard/project/' + this.props.currentProject.slug
            : '';

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
        const showResolveButton = this.props.multipleIncidentRequest
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
            ? !this.props.multipleIncidentRequest.resolving
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
            : this.props.incidentRequest &&
              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
              !this.props.incidentRequest.resolving;

        const incidentReason =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.reason &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            changeFormat(this.props.incident.reason);

        function changeFormat(data: $TSFixMe) {
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

        const formatAckDate = (otherDate: $TSFixMe, createdDate: $TSFixMe) => {
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

        let teamMembers = this.getOnCallTeamMembers();
        if (!teamMembers) {
            teamMembers = [];
        }
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'member' implicitly has an 'any' type.
        const team = teamMembers.filter(member => member.userId);

        return <>
            <ShouldRender
                if={
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
                    (!this.props.route ||
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
                        (this.props.route &&
                            !(
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                this.props.route === homeRoute ||
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Read... Remove this comment to see the full error message
                                !this.props.incidentId
                            ))) &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.incident.acknowledged &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.incident.resolved &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                        <div className="bs-numb">{`#${this.props.incident.idNumber}`}</div>
                                    </div>
                                    <div className="bs-incident-title bs-i-title-right">
                                        <div className="bs--header">
                                            <div className="bs-font-header">
                                                {monitorName}{' '}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                {this.props.incident &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                this.props.incident
                                                    .monitors &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                this.props.incident.monitors
                                                    .length > 1
                                                    ? 'are'
                                                    : 'is'}{' '}
                                                {
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                    this.props.incident
                                                        .incidentType
                                                }
                                            </div>
                                            {/* {((incidentReason &&
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
                                            )} */}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                            {this.props.incident
                                                .manuallyCreated &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                        .incident
                                                                        .createdById
                                                                        ._id
                                                                }
                                                            >
                                                                <div>
                                                                    {
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                            .incident
                                                                            .createdById
                                                                            .name
                                                                    }
                                                                </div>
                                                            </Link>
                                                        </span>
                                                    </div>
                                                )}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                            {this.props.incident &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                this.props.incident
                                                    .monitors &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                this.props.incident.monitors.map(
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                    (monitorObj: $TSFixMe) => this.props.incident
                                                        .incidentType &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                    this.props.incident
                                                        .reason &&
                                                    incidentReason &&
                                                    incidentReason.length ===
                                                        1 &&
                                                    monitorObj.monitorId
                                                        .type !==
                                                        'api' &&
                                                    incidentReason &&
                                                    incidentReason.join()
                                                        .length <=
                                                        30 && (
                                                        <div className="bs-font-normal bs-flex-display">
                                                            <label className="bs-h">
                                                                Cause:
                                                            </label>
                                                            <div
                                                                className="bs-content-inside bs-status"
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                id={`${monitorObj.name}_IncidentReport_${this.props.count}`}
                                                            >
                                                                <ReactMarkdown
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ source: string; }' is not assignable to ty... Remove this comment to see the full error message
                                                                    source={`${' ' +
                                                                        incidentReason.map(
                                                                            (a: $TSFixMe) => {
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
                                                    )
                                                )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16 bs-mob-flex">
                                <div
                                    className={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                        this.props.incident.acknowledged &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                        this.props.incident.resolved
                                            ? 'bs-flex-display bs-remove-shadow'
                                            : 'bs-flex-display'
                                    }
                                >
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    {this.props.incident.acknowledged &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                        this.props.incident.resolved &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                        this.props.route &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Read... Remove this comment to see the full error message
                                        !this.props.incidentId && (
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    {(!this.props.incident.acknowledged ||
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.incident
                                                .acknowledged &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.incident.resolved
                                                ? 'bs-resolved-green'
                                                : 'bs-exclaim'
                                        }
                                    >
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                        {!this.props.incident
                                            .acknowledged ? (
                                            <span className="bs-active-in">
                                                This is an Active Incident
                                            </span>
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                        ) : this.props.incident
                                              .acknowledged &&
                                          // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                          !this.props.incident.resolved ? (
                                            <span className="bs-active-in">
                                                This is an Active Incident
                                            </span>
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                        ) : this.props.route &&
                                          // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Read... Remove this comment to see the full error message
                                          !this.props.incidentId ? (
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
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                            {`#${this.props.incident.idNumber}`}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="bs-content">
                                                    <label className="">
                                                        Monitor(s)
                                                    </label>
                                                    <div>
                                                        {this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                            .incident &&
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                .incident
                                                                .monitors &&
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                            this.props.incident.monitors.map(
                                                                (monitorObj: $TSFixMe) => <div
                                                                    key={
                                                                        monitorObj
                                                                            .monitorId
                                                                            ._id
                                                                    }
                                                                    className="bs-content-inside"
                                                                >
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                                    .currentProject
                                                                                    .slug +
                                                                                '/component/' +
                                                                                monitorObj
                                                                                    .monitorId
                                                                                    .componentId
                                                                                    .slug +
                                                                                '/monitoring'
                                                                            }
                                                                            id="backToComponentView"
                                                                        >
                                                                            {
                                                                                monitorObj
                                                                                    .monitorId
                                                                                    .componentId
                                                                                    .name
                                                                            }
                                                                        </Link>
                                                                    </span>
                                                                    {
                                                                        ' / '
                                                                    }
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                                    .currentProject
                                                                                    .slug +
                                                                                '/component/' +
                                                                                monitorObj
                                                                                    .monitorId
                                                                                    .componentId
                                                                                    .slug +
                                                                                '/monitoring/' +
                                                                                monitorObj
                                                                                    .monitorId
                                                                                    .slug
                                                                            }
                                                                            id="backToMonitorView"
                                                                        >
                                                                            {
                                                                                monitorObj
                                                                                    .monitorId
                                                                                    .name
                                                                            }
                                                                        </Link>
                                                                    </span>
                                                                </div>
                                                            )}
                                                    </div>
                                                </div>
                                                <div className="bs-content">
                                                    <label className="">
                                                        Incident Status:
                                                    </label>
                                                    <div className="bs-content-inside bs-margin-off">
                                                        <span className="value">
                                                            {this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                .incident &&
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                .incident
                                                                .incidentType &&
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                  .incident &&
                                                              this.props
                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                  .incident
                                                                  .incidentType &&
                                                              this.props
                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                  .incident &&
                                                              this.props
                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                  .incident
                                                                  .incidentType &&
                                                              this.props
                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                        by{' '}
                                                                    </span>
                                                                    <span className=" bs-text-bold">
                                                                        {this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                        .incident
                                                                                        .createdById
                                                                                        ._id
                                                                                }
                                                                            >
                                                                                {
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                        .incident
                                                                                        .createdById
                                                                                        .name
                                                                                }
                                                                            </Link>
                                                                        ) : this
                                                                              .props
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                              .incident
                                                                              .createdByZapier ? (
                                                                            'Zapier'
                                                                        ) : this
                                                                              .props
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                              .incident
                                                                              .createdByApi ? (
                                                                            'API'
                                                                        ) : this
                                                                              .props
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                              .incident
                                                                              .probes &&
                                                                          this
                                                                              .props
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                              .incident
                                                                              .probes[0] &&
                                                                          this
                                                                              .props
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                              .incident
                                                                              .probes[0]
                                                                              .probeId ? (
                                                                            this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                .incident
                                                                                .probes[0]
                                                                                .probeId
                                                                                .probeName +
                                                                            ' probe'
                                                                        ) : (
                                                                            'OneUptime'
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
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                .incident
                                                                                .createdAt
                                                                        ).fromNow()}
                                                                        ).
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                        id={`btnAcknowledge_${this.props.count}`}
                                                                        onClick={() =>
                                                                            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
                                                                                    .incidentRequest &&
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
                                                                                        .incidentRequest
                                                                                        .requesting) ||
                                                                                    (this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                                                                        .multipleIncidentRequest &&
                                                                                        this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                                                                            .multipleIncidentRequest
                                                                                            .requesting) ||
                                                                                    (this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
                                                                                        .incidentRequest &&
                                                                                        this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
                                                                                            .incidentRequest
                                                                                            .resolving) ||
                                                                                    (this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                                                                        .multipleIncidentRequest &&
                                                                                        this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                                                                            .multipleIncidentRequest
                                                                                            .resolving) ||
                                                                                    this
                                                                                        .state
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'acknowledging' does not exist on type 'R... Remove this comment to see the full error message
                                                                                        .acknowledging) &&
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeIncident' does not exist on type '... Remove this comment to see the full error message
                                                                                    .activeIncident ===
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                        .incident
                                                                                        ._id
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
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveLoad' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                            .resolveLoad ? null : !this
                                                                              .props
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                              .incident
                                                                              .acknowledged &&
                                                                          !this
                                                                              .state
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveLoad' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                              .resolveLoad &&
                                                                          this
                                                                              .state
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                              .value !==
                                                                              1 &&
                                                                          !this
                                                                              .state
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'stats' does not exist on type 'Readonly<... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                            id={`AcknowledgeText_${this.props.count}`}
                                                                            className="bs-margin-right bs-text-bold"
                                                                        >
                                                                            Acknowledged
                                                                            by{' '}
                                                                            {this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                .incident
                                                                                .acknowledgedBy ===
                                                                            null ? (
                                                                                <span>
                                                                                    {this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                        .incident
                                                                                        .acknowledgedByZapier
                                                                                        ? 'Zapier'
                                                                                        : this
                                                                                              .props
                                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                              .incident
                                                                                              .acknowledgedByApi
                                                                                        ? 'API'
                                                                                        : this
                                                                                              .props
                                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                              .incident
                                                                                              .acknowledgedByIncomingHttpRequest
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                        ? `Incoming HTTP Request ${this.props.incident.acknowledgedByIncomingHttpRequest.name}`
                                                                                        : 'OneUptime'}
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
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                            .incident
                                                                                            .acknowledgedBy
                                                                                            ._id
                                                                                    }
                                                                                >
                                                                                    {
                                                                                        this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .incident
                                                                                    .acknowledgedAt
                                                                            ).format(
                                                                                'MMMM Do YYYY'
                                                                            )}{' '}
                                                                            at{' '}
                                                                            {moment(
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .incident
                                                                                    .acknowledgedAt
                                                                            ).format(
                                                                                'h:mm:ss a'
                                                                            )}{' '}
                                                                            (
                                                                            {moment(
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .incident
                                                                                    .acknowledgedAt,
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                                id={`ResolveText_${this.props.count}`}
                                                                                className="bs-margin-right bs-text-bold"
                                                                            >
                                                                                Resolved
                                                                                by{' '}
                                                                                {this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .incident
                                                                                    .resolvedBy ===
                                                                                null ? (
                                                                                    <span>
                                                                                        {this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                            .incident
                                                                                            .resolvedByZapier
                                                                                            ? 'Zapier'
                                                                                            : this
                                                                                                  .props
                                                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                                  .incident
                                                                                                  .resolvedByApi
                                                                                            ? `API`
                                                                                            : this
                                                                                                  .props
                                                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                                  .incident
                                                                                                  .resolvedByIncomingHttpRequest
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                            ? `Incoming HTTP Request ${this.props.incident.resolvedByIncomingHttpRequest.name}`
                                                                                            : 'OneUptime'}
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
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                                .incident
                                                                                                .resolvedBy
                                                                                                ._id
                                                                                        }
                                                                                    >
                                                                                        {
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                                id={`ResolveText_${this.props.count}`}
                                                                                className="bs-margin-right"
                                                                            >
                                                                                Resolved
                                                                                on{' '}
                                                                                {moment(
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                        .incident
                                                                                        .resolvedAt
                                                                                ).format(
                                                                                    'MMMM Do YYYY'
                                                                                )}{' '}
                                                                                at{' '}
                                                                                {moment(
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                        .incident
                                                                                        .resolvedAt
                                                                                ).format(
                                                                                    'h:mm:ss a'
                                                                                )}{' '}
                                                                                (
                                                                                {moment(
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .incident
                                                                                    .resolvedAt,
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                                id={`btnResolve_${this.props.count}`}
                                                                                onClick={() =>
                                                                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
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
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
                                                                                            .incidentRequest &&
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
                                                                                                .incidentRequest
                                                                                                .requesting) ||
                                                                                            (this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                                                                                .multipleIncidentRequest &&
                                                                                                this
                                                                                                    .props
                                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                                                                                    .multipleIncidentRequest
                                                                                                    .requesting) ||
                                                                                            (this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
                                                                                                .incidentRequest &&
                                                                                                this
                                                                                                    .props
                                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
                                                                                                    .incidentRequest
                                                                                                    .resolving) ||
                                                                                            (this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                                                                                .multipleIncidentRequest &&
                                                                                                this
                                                                                                    .props
                                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                                                                                    .multipleIncidentRequest
                                                                                                    .resolving) ||
                                                                                            this
                                                                                                .state
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolving' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                                                .resolving) &&
                                                                                        this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeIncident' does not exist on type '... Remove this comment to see the full error message
                                                                                            .activeIncident ===
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                                .incident
                                                                                                ._id
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveLoad' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                                    .resolveLoad ? null : this
                                                                                      .props
                                                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                      .incident
                                                                                      .acknowledged &&
                                                                                  !this
                                                                                      .props
                                                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                      .incident
                                                                                      .resolved &&
                                                                                  !this
                                                                                      .state
                                                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveLoad' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                                      .resolveLoad &&
                                                                                  this
                                                                                      .state
                                                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Readonly<... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                {this.props.incident
                                                    .title && (
                                                    <div className="bs-content bs-title">
                                                        <label className="">
                                                            Title
                                                        </label>

                                                        <ShouldRender
                                                            if={
                                                                this.state
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'firstVisibility' does not exist on type ... Remove this comment to see the full error message
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
                                                                    id="incidentTitle"
                                                                    className="value"
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
                                                                    onClick={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editable' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                            .editable
                                                                            ? this
                                                                                  .firstIconClick
                                                                            : null
                                                                    }
                                                                    style={{
                                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '"pointer" | null' is not assignable to type ... Remove this comment to see the full error message
                                                                        cursor: this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editable' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                            .editable
                                                                            ? 'pointer'
                                                                            : null,
                                                                    }}
                                                                >
                                                                    {
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                            .incident
                                                                            .title
                                                                    }
                                                                </span>{' '}
                                                                <ShouldRender
                                                                    if={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editable' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'firstHover' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'firstVisibility' does not exist on type ... Remove this comment to see the full error message
                                                                    .firstVisibility
                                                            }
                                                        >
                                                            <form
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
                                                                        handleBlur={this.props.handleSubmit(
                                                                            // The RenderField Component has been refactored
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                {this.props.incident
                                                    .description && (
                                                    <div className="bs-content">
                                                        <label className="">
                                                            Description
                                                        </label>
                                                        <ShouldRender
                                                            if={
                                                                this.state
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'secondVisibility' does not exist on type... Remove this comment to see the full error message
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
                                                                    id="incidentDescription"
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
                                                                    onClick={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editable' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '"pointer" | null' is not assignable to type ... Remove this comment to see the full error message
                                                                        cursor: this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editable' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                            .editable
                                                                            ? 'pointer'
                                                                            : null,
                                                                    }}
                                                                >
                                                                    {
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                            .incident
                                                                            .description
                                                                    }
                                                                </p>{' '}
                                                                <ShouldRender
                                                                    if={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editable' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'secondHover' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'secondVisibility' does not exist on type... Remove this comment to see the full error message
                                                                    .secondVisibility
                                                            }
                                                        >
                                                            <form
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                {this.props.incident
                                                    .manuallyCreated &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                .incident
                                                                                .createdById
                                                                                ._id
                                                                        }
                                                                    >
                                                                        <div>
                                                                            {
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                {this.props.incident
                                                    .incidentType &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                    this.props.incident
                                                        .reason && (
                                                        <div className="bs-content">
                                                            <label className="">
                                                                Cause
                                                            </label>
                                                            <div
                                                                className="bs-content-inside"
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                id={`${monitorName}_IncidentReport_${this.props.count}`}
                                                            >
                                                                <ReactMarkdown>
                                                                    {`${
                                                                        incidentReason &&
                                                                        incidentReason.length >
                                                                            1
                                                                            ? incidentReason
                                                                                  .map(
                                                                                      (a: $TSFixMe) => {
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
                                                                                  (a: $TSFixMe) => {
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
                                                                </ReactMarkdown>
                                                            </div>
                                                            {this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                .incident
                                                                .response &&
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                    .incident
                                                                    .reason && (
                                                                    <button
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                        id={`${monitorName}_ShowResponse_${this.props.count}`}
                                                                        title="Show Response Body"
                                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton Flex-flex"
                                                                        type="button"
                                                                        onClick={() =>
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                            this.props.openModal(
                                                                                {
                                                                                    id: this
                                                                                        .state
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'viewJsonModalId' does not exist on type ... Remove this comment to see the full error message
                                                                                        .viewJsonModalId,
                                                                                    content: DataPathHoC(
                                                                                        ViewJsonLogs,
                                                                                        {
                                                                                            viewJsonModalId: this
                                                                                                .state
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'viewJsonModalId' does not exist on type ... Remove this comment to see the full error message
                                                                                                .viewJsonModalId,
                                                                                            jsonLog: this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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

                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                {this.props.incident
                                                    .criterionCause &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                    this.props.incident
                                                        .criterionCause
                                                        .name && (
                                                        <div className="bs-content">
                                                            <label className="">
                                                                Criterion
                                                            </label>
                                                            <div className="bs-content-inside">
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                {`${this.props.incident.criterionCause.name}`}
                                                            </div>
                                                        </div>
                                                    )}

                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'thirdVisibility' does not exist on type ... Remove this comment to see the full error message
                                                                        .thirdVisibility
                                                                }
                                                            >
                                                                <div className="Flex-flex Flex-alignItems--center bs-justify-cont">
                                                                    <span
                                                                        className="Margin-right--4"
                                                                        style={{
                                                                            display:
                                                                                'inline',
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                            id="incidentPriority"
                                                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
                                                                            onClick={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editable' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .editable
                                                                                    ? this
                                                                                          .thirdIconClick
                                                                                    : null
                                                                            }
                                                                            className="Text-fontWeight--medium"
                                                                            style={{
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                color: `rgba(${this.props.incident.incidentPriority.color.r},${this.props.incident.incidentPriority.color.g},${this.props.incident.incidentPriority.color.b},${this.props.incident.incidentPriority.color.a})`,
                                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '"pointer" | null' is not assignable to type ... Remove this comment to see the full error message
                                                                                cursor: this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editable' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .editable
                                                                                    ? 'pointer'
                                                                                    : null,
                                                                            }}
                                                                        >
                                                                            {
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .incident
                                                                                    .incidentPriority
                                                                                    .name
                                                                            }
                                                                        </span>{' '}
                                                                        <ShouldRender
                                                                            if={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editable' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'thirdHover' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'thirdVisibility' does not exist on type ... Remove this comment to see the full error message
                                                                        .thirdVisibility
                                                                }
                                                            >
                                                                <form
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentPriorities' does not exist on ty... Remove this comment to see the full error message
                                                                                    ...this.props.incidentPriorities.map(
                                                                                        (incidentPriority: $TSFixMe) => ({
                                                                                            value:
                                                                                                incidentPriority._id,

                                                                                            label:
                                                                                                incidentPriority.name
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                {this.props.incident
                                                    .customFields &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                    this.props.incident
                                                        .customFields
                                                        .length > 0 &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                    this.props.incident.customFields.map(
                                                        (field: $TSFixMe, index: $TSFixMe) => (
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
                                                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'member' implicitly has an 'any' type.
                                                                member => (
                                                                    <div
                                                                        className="Box-root Margin-right--16 pointer"
                                                                        key={
                                                                            member.user &&
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
                                                                            {member.user &&
                                                                                (member
                                                                                    .user
                                                                                    .name
                                                                                    ? member
                                                                                          .user
                                                                                          .name
                                                                                    : member
                                                                                          .user
                                                                                          .email)}
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.incident &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                    this.props.route &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    !this.props.incident.slug
                                }
                            >
                                <button
                                    className="bs-Button bs-Button--more bs-btn-extra"
                                    id={`${monitorName}_ViewIncidentDetails`}
                                    type="button"
                                    onClick={() => {
                                        setTimeout(() => {
                                            history.push(
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                `/dashboard/project/${this.props.incident.projectId.slug}/incidents/${this.props.incident.slug}`
                                            );
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
                                            this.props.animateSidebar(
                                                false
                                            );
                                        }, 200);
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'markAsRead' does not exist on type 'Read... Remove this comment to see the full error message
                                        this.props.markAsRead(
                                            projectId,
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.incident
                                                .notifications
                                        );
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
                                        this.props.animateSidebar(true);
                                    }}
                                >
                                    <span>View Incident</span>
                                </button>
                            </ShouldRender>
                            <FooterButton
                                className={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.incident.acknowledged &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.incident.resolved
                                        ? 'bs-btn-extra bs-Button bs-flex-display bs-remove-shadow'
                                        : 'bs-btn-extra bs-Button bs-flex-display'
                                }
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ className: string; id: string; type: strin... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.incident.acknowledged
                                }
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                resolved={this.props.incident.resolved}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                route={this.props.route}
                                homeRoute={homeRoute}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Read... Remove this comment to see the full error message
                                incidentId={this.props.incidentId}
                                state={this.state}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentRequest' does not exist on type ... Remove this comment to see the full error message
                                incidentRequest={this.props.incidentRequest}
                                multipleIncidentRequest={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                    this.props.multipleIncidentRequest
                                }
                            />
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'multiple' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.multiple &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.incident &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.incident.acknowledged &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.incident.resolved
                                }
                            >
                                <button
                                    onClick={() => {
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                        this.props.incident.resolved
                                            ? this.closeIncident()
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                            : this.props.openModal({
                                                  id: this.state
                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'messageModalId' does not exist on type '... Remove this comment to see the full error message
                                                      .messageModalId,
                                                  onClose: () => '',
                                                  content: DataPathHoC(
                                                      MessageBox,
                                                      {
                                                          messageBoxId: this
                                                              .state
                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'messageModalId' does not exist on type '... Remove this comment to see the full error message
                                                              .messageModalId,
                                                          title: 'Warning',
                                                          message:
                                                              'This incident cannot be closed because it is not acknowledged or resolved',
                                                      }
                                                  ),
                                              });
                                    }}
                                    className={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                        this.props.closeincident &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                        this.props.closeincident
                                            .requesting &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                        this.props.closeincident
                                            .requesting ===
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.incident._id
                                            ? 'bs-Button bs-Button--blue bs-btn-extra'
                                            : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-btn-extra'
                                    }
                                    disabled={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                        this.props.closeincident &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                        this.props.closeincident
                                            .requesting &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                        this.props.closeincident
                                            .requesting ===
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.incident._id
                                    }
                                    type="button"
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                    id={`closeIncidentButton_${this.props.count}`}
                                    style={{ marginLeft: '-16px' }}
                                >
                                    <ShouldRender
                                        if={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                            this.props.closeincident &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                            this.props.closeincident
                                                .requesting &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                            this.props.closeincident
                                                .requesting ===
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                                                this.props.incident._id
                                        }
                                    >
                                        <FormLoader />
                                    </ShouldRender>
                                    <ShouldRender
                                        if={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                            this.props.closeincident &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                            (!this.props.closeincident
                                                .requesting ||
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                                (this.props.closeincident
                                                    .requesting &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeincident' does not exist on type 'R... Remove this comment to see the full error message
                                                    this.props.closeincident
                                                        .requesting !==
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
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
        </>;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
IncidentStatus.displayName = 'IncidentStatus';

const EditIncidentStatusForm = reduxForm({
    form: 'IncidentStatusForm',
    enableReinitialize: true,
})(IncidentStatus);
const selector = formValueSelector('IncidentStatusForm');
const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { incidentId } = ownProps.match.params;
    const incident = ownProps.incident;
    const initialValues = {
        title: incident.title,
        description: incident.description,
        incidentPriority: incident.incidentPriority
            ? incident.incidentPriority._id
            : '',
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
        incidentId,
        activeIncident: state.incident.activeIncident,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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
            fetchIncidentMessages,
        },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
    route: PropTypes.string,
    incidentRequest: PropTypes.object.isRequired,
    multipleIncidentRequest: PropTypes.object,
    markAsRead: PropTypes.func,
    getIncidentTimeline: PropTypes.func,
    animateSidebar: PropTypes.func,
    escalations: PropTypes.array,
    editable: PropTypes.bool,
    incidentPriorities: PropTypes.array.isRequired,
    incidentId: PropTypes.string,
    fetchIncidentMessages: PropTypes.func,
    activeIncident: PropTypes.string,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(EditIncidentStatusForm)
);
