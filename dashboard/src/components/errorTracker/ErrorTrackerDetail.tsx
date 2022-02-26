import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import {
    fetchErrorTrackerIssues,
    deleteErrorTracker,
    editErrorTrackerSwitch,
    resetErrorTrackerKey,
    ignoreErrorEvent,
    resolveErrorEvent,
    updateErrorEventMember,
    getErrorEventSuccess,
} from '../../actions/errorTracker';
import { subProjectTeamLoading } from '../../actions/team';
import { bindActionCreators } from 'redux';
import ErrorTrackerHeader from './ErrorTrackerHeader';
import ErrorTrackerDetailView from './ErrorTrackerDetailView';
import { history } from '../../store';
import { openModal, closeModal } from '../../actions/modal';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import ShouldRender from '../basic/ShouldRender';
import NewErrorTracker from './NewErrorTracker';

import moment from 'moment';
import ErrorEventUtil from '../../utils/ErrorEventUtil';
import { socket } from '../basic/Socket';

class ErrorTrackerDetail extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            deleteModalId: uuidv4(),
            trackerKeyModalId: uuidv4(),
            filters: null,
        };
    }
    viewMore = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, componentSlug, errorTracker } = this.props;
        history.push(
            '/dashboard/project/' +
                currentProject.slug +
                '/component/' +
                componentSlug +
                '/error-trackers/' +
                errorTracker.slug
        );
    };
    resetErrorTrackerKey = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetErrorTrackerKey' does not exist on ... Remove this comment to see the full error message
            resetErrorTrackerKey,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
        } = this.props;
        return resetErrorTrackerKey(
            currentProject._id,
            componentId,
            errorTracker._id
        ).then(() => {
            closeModal({
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerKeyModalId' does not exist on typ... Remove this comment to see the full error message
                id: this.state.trackerKeyModalId,
            });
        });
    };
    deleteErrorTracker = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteErrorTracker' does not exist on ty... Remove this comment to see the full error message
            deleteErrorTracker,
        } = this.props;
        const promise = deleteErrorTracker(
            currentProject._id,
            componentId,
            errorTracker._id
        );
        history.push(
            '/dashboard/project/' +
                currentProject.slug +
                '/component/' +
                componentSlug +
                '/error-tracker'
        );
        return promise;
    };
    editErrorTracker = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editErrorTrackerSwitch' does not exist o... Remove this comment to see the full error message
        const { editErrorTrackerSwitch, errorTracker } = this.props;
        editErrorTrackerSwitch(errorTracker._id);
    };
    ignoreErrorEvent = (issues: $TSFixMe, ignore: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ignoreErrorEvent' does not exist on type... Remove this comment to see the full error message
            ignoreErrorEvent,
        } = this.props;

        return ignoreErrorEvent(
            currentProject._id,
            componentId,
            errorTracker._id,
            issues,
            ignore
        );
    };
    updateErrorEventMember = (issueId: $TSFixMe, userId: $TSFixMe, type: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateErrorEventMember' does not exist o... Remove this comment to see the full error message
            updateErrorEventMember,
        } = this.props;
        return updateErrorEventMember(
            currentProject._id,
            componentId,
            errorTracker._id,
            issueId,
            [userId],
            type
        );
    };
    resolveErrorEvent = (issues: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveErrorEvent' does not exist on typ... Remove this comment to see the full error message
            resolveErrorEvent,
        } = this.props;
        return resolveErrorEvent(
            currentProject._id,
            componentId,
            errorTracker._id,
            issues
        );
    };
    handleStartDateTimeChange = (val: $TSFixMe) => {
        const startDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
        this.fetchByDateChange(startDate, this.props.endDate);
    };
    handleEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
        this.fetchByDateChange(this.props.startDate, endDate);
    };
    handleFilterUpdate = (val: $TSFixMe) => {
        const filters = ErrorEventUtil.generateFilterOption(val);
        this.setState(() => ({
            filters: filters,
        }));
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackerIssues' does not exist ... Remove this comment to see the full error message
            fetchErrorTrackerIssues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
        } = this.props;
        fetchErrorTrackerIssues(
            currentProject._id,
            componentId,
            errorTracker._id,
            0,
            10,
            startDate,
            endDate,
            filters
        );
    };
    fetchByDateChange = (startDate: $TSFixMe, endDate: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackerIssues' does not exist ... Remove this comment to see the full error message
            fetchErrorTrackerIssues,
        } = this.props;
        if (moment(startDate).isBefore(endDate)) {
            fetchErrorTrackerIssues(
                currentProject._id,
                componentId,
                errorTracker._id,
                0,
                10,
                startDate,
                endDate,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'filters' does not exist on type 'Readonl... Remove this comment to see the full error message
                this.state.filters
            );
        }
    };
    handleNavigationButtonClick = (skip: $TSFixMe, limit: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackerIssues' does not exist ... Remove this comment to see the full error message
            fetchErrorTrackerIssues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
        } = this.props;
        fetchErrorTrackerIssues(
            currentProject._id,
            componentId,
            errorTracker._id,
            skip,
            limit,
            startDate,
            endDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filters' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.state.filters
        );
    };
    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackerIssues' does not exist ... Remove this comment to see the full error message
            fetchErrorTrackerIssues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showComponentWithIssue' does not exist o... Remove this comment to see the full error message
            showComponentWithIssue,
        } = this.props;
        fetchErrorTrackerIssues(
            currentProject._id,
            componentId,
            errorTracker._id,
            0,
            10,
            startDate,
            endDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filters' does not exist on type 'Readonl... Remove this comment to see the full error message
            showComponentWithIssue ? { resolved: false } : this.state.filters
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (!this.props.currentProject) {
            const projectId = history.location.pathname
                .split('project/')[1]
                .split('/')[0];
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
            this.props.subProjectTeamLoading(projectId);
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
            this.props.subProjectTeamLoading(this.props.currentProject._id);
        }
    }
    componentWillUnmount() {
        socket.removeListener(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            `createErrorEvent-${this.props.errorTracker._id}`
        );
    }
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerIssue' does not exist on typ... Remove this comment to see the full error message
            errorTrackerIssue,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDetails' does not exist on type 'Reado... Remove this comment to see the full error message
            isDetails,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMembers' does not exist on type 'Rea... Remove this comment to see the full error message
            teamMembers,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showComponentWithIssue' does not exist o... Remove this comment to see the full error message
            showComponentWithIssue,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteModalId' does not exist on type 'R... Remove this comment to see the full error message
        const { deleteModalId, trackerKeyModalId } = this.state;

        if (errorTracker) {
            // join room
            socket.emit('error_tracker_switch', errorTracker._id);

            socket.on(`createErrorEvent-${errorTracker._id}`, (data: $TSFixMe) => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getErrorEventSuccess' does not exist on ... Remove this comment to see the full error message
                this.props.getErrorEventSuccess(data);
            });
        }
        const shouldRender = showComponentWithIssue
            ? errorTrackerIssue
                ? errorTrackerIssue.errorTrackerIssues.length > 0
                : false
            : true;
        if (errorTracker && shouldRender) {
            return (
                <div className="bs-BIM">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div>
                                    <ShouldRender if={!errorTracker.editMode}>
                                        <ErrorTrackerHeader
                                            errorTracker={errorTracker}
                                            errorTrackerIssue={
                                                errorTrackerIssue
                                            }
                                            isDetails={isDetails}
                                            viewMore={this.viewMore}
                                            deleteErrorTracker={
                                                this.deleteErrorTracker
                                            }
                                            openModal={openModal}
                                            deleteModalId={deleteModalId}
                                            editErrorTracker={
                                                this.editErrorTracker
                                            }
                                            trackerKeyModalId={
                                                trackerKeyModalId
                                            }
                                            resetErrorTrackerKey={
                                                this.resetErrorTrackerKey
                                            }
                                            handleStartDateTimeChange={
                                                this.handleStartDateTimeChange
                                            }
                                            handleEndDateTimeChange={
                                                this.handleEndDateTimeChange
                                            }
                                            handleFilterUpdate={
                                                this.handleFilterUpdate
                                            }
                                            formId="errorTrackerDateTimeForm"
                                            showComponentWithIssue={
                                                showComponentWithIssue
                                            }
                                        />
                                    </ShouldRender>
                                    <ShouldRender if={errorTracker.editMode}>
                                        <NewErrorTracker
                                            edit={errorTracker.editMode}
                                            errorTracker={errorTracker}
                                            index={errorTracker._id}
                                            componentId={componentId}
                                            componentSlug={componentSlug}
                                        />
                                    </ShouldRender>

                                    <div>
                                        <ErrorTrackerDetailView
                                            errorTracker={errorTracker}
                                            componentId={componentId}
                                            projectId={currentProject._id}
                                            handleNavigationButtonClick={
                                                this.handleNavigationButtonClick
                                            }
                                            ignoreErrorEvent={
                                                this.ignoreErrorEvent
                                            }
                                            resolveErrorEvent={
                                                this.resolveErrorEvent
                                            }
                                            openModal={openModal}
                                            updateErrorEventMember={
                                                this.updateErrorEventMember
                                            }
                                            teamMembers={teamMembers}
                                            slug={currentProject.slug}
                                            componentSlug={componentSlug}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        } else {
            return null;
        }
    }
}
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ErrorTrackerDetail.displayName = 'ErrorTrackerDetail';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ErrorTrackerDetail.propTypes = {
    errorTracker: PropTypes.object,
    fetchErrorTrackerIssues: PropTypes.func,
    currentProject: PropTypes.object,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    errorTrackerIssue: PropTypes.object,
    isDetails: PropTypes.bool,
    deleteErrorTracker: PropTypes.func,
    openModal: PropTypes.func,
    editErrorTrackerSwitch: PropTypes.func,
    resetErrorTrackerKey: PropTypes.func,
    closeModal: PropTypes.func,
    startDate: PropTypes.string,
    endDate: PropTypes.string,
    ignoreErrorEvent: PropTypes.func,
    resolveErrorEvent: PropTypes.func,
    updateErrorEventMember: PropTypes.func,
    subProjectTeamLoading: PropTypes.func,
    teamMembers: PropTypes.array,
    showComponentWithIssue: PropTypes.bool,
    getErrorEventSuccess: PropTypes.func,
};
const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            fetchErrorTrackerIssues,
            deleteErrorTracker,
            openModal,
            editErrorTrackerSwitch,
            resetErrorTrackerKey,
            closeModal,
            ignoreErrorEvent,
            resolveErrorEvent,
            updateErrorEventMember,
            subProjectTeamLoading,
            getErrorEventSuccess,
        },
        dispatch
    );
};
function mapStateToProps(state: $TSFixMe, ownProps: $TSFixMe) {
    const errorTrackerId = ownProps.index;
    const errorTrackers = state.errorTracker.errorTrackersList.errorTrackers;
    const currentErrorTracker = errorTrackers.filter(
        (errorTracker: $TSFixMe) => errorTracker._id === errorTrackerId
    );
    const errorTrackerIssue =
        state.errorTracker.errorTrackerIssues[errorTrackerId];
    const startDate = state.form.errorTrackerDateTimeForm
        ? state.form.errorTrackerDateTimeForm.values
            ? state.form.errorTrackerDateTimeForm.values.startDate
            : ''
        : '';
    const endDate = state.form.errorTrackerDateTimeForm
        ? state.form.errorTrackerDateTimeForm.values
            ? state.form.errorTrackerDateTimeForm.values.endDate
            : ''
        : '';
    const teamMembers = state.team.subProjectTeamMembers.find(
        (subProjectTeamMember: $TSFixMe) => subProjectTeamMember._id === state.project.currentProject._id
    );
    return {
        errorTracker: currentErrorTracker[0],
        currentProject: state.project.currentProject,
        componentSlug:
            state.component.currentComponent.component &&
            state.component.currentComponent.component.slug,
        errorTrackerIssue,
        editMode: currentErrorTracker[0].editMode,
        startDate,
        endDate,
        teamMembers: teamMembers ? teamMembers.teamMembers : [],
    };
}
export default connect(mapStateToProps, mapDispatchToProps)(ErrorTrackerDetail);
