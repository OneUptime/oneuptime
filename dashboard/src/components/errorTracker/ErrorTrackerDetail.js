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
} from '../../actions/errorTracker';
import { subProjectTeamLoading } from '../../actions/team';
import { bindActionCreators } from 'redux';
import ErrorTrackerHeader from './ErrorTrackerHeader';
import ErrorTrackerDetailView from './ErrorTrackerDetailView';
import { history } from '../../store';
import { openModal, closeModal } from '../../actions/modal';
import uuid from 'uuid';
import ShouldRender from '../basic/ShouldRender';
import NewErrorTracker from './NewErrorTracker';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from 'amplitude-js';
import moment from 'moment';
import ErrorEventUtil from '../../utils/ErrorEventUtil';

class ErrorTrackerDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            deleteModalId: uuid.v4(),
            trackerKeyModalId: uuid.v4(),
        };
    }
    viewMore = () => {
        const { currentProject, componentId, errorTracker } = this.props;
        history.push(
            '/dashboard/project/' +
                currentProject._id +
                '/' +
                componentId +
                '/error-trackers/' +
                errorTracker._id
        );
    };
    resetErrorTrackerKey = () => {
        const {
            currentProject,
            componentId,
            errorTracker,
            resetErrorTrackerKey,
            closeModal,
        } = this.props;
        return resetErrorTrackerKey(
            currentProject._id,
            componentId,
            errorTracker._id
        ).then(() => {
            closeModal({
                id: this.state.trackerKeyModalId,
            });
            if (SHOULD_LOG_ANALYTICS) {
                logEvent(
                    'EVENT: DASHBOARD > COMPONENTS > ERROR TRACKER > ERROR TRACKER DETAILS > RESET ERROR TRACKER KEY',
                    {
                        errorTrackerId: errorTracker._id,
                    }
                );
            }
        });
    };
    deleteErrorTracker = () => {
        const {
            currentProject,
            componentId,
            errorTracker,
            deleteErrorTracker,
        } = this.props;
        const promise = deleteErrorTracker(
            currentProject._id,
            componentId,
            errorTracker._id
        );
        history.push(
            '/dashboard/project/' +
                currentProject._id +
                '/' +
                componentId +
                '/error-tracker'
        );
        return promise;
    };
    editErrorTracker = () => {
        const { editErrorTrackerSwitch, errorTracker } = this.props;
        editErrorTrackerSwitch(errorTracker._id);
    };
    ignoreErrorEvent = issues => {
        const {
            currentProject,
            componentId,
            errorTracker,
            ignoreErrorEvent,
        } = this.props;
        return ignoreErrorEvent(
            currentProject._id,
            componentId,
            errorTracker._id,
            issues
        );
    };
    updateErrorEventMember = (issueId, userId, type) => {
        const {
            currentProject,
            componentId,
            errorTracker,
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
    resolveErrorEvent = issues => {
        const {
            currentProject,
            componentId,
            errorTracker,
            resolveErrorEvent,
        } = this.props;
        return resolveErrorEvent(
            currentProject._id,
            componentId,
            errorTracker._id,
            issues
        );
    };
    handleStartDateTimeChange = val => {
        const startDate = moment(val);
        this.fetchByDateChange(startDate, this.props.endDate);
    };
    handleEndDateTimeChange = val => {
        const endDate = moment(val);
        this.fetchByDateChange(this.props.startDate, endDate);
    };
    handleFilterUpdate = val => {
        const filters = ErrorEventUtil.generateFilterOption(val);
        const {
            fetchErrorTrackerIssues,
            currentProject,
            errorTracker,
            componentId,
            startDate,
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
    fetchByDateChange = (startDate, endDate) => {
        const {
            errorTracker,
            currentProject,
            componentId,
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
                endDate
            );
        }
    };
    handleNavigationButtonClick = (skip, limit) => {
        const {
            fetchErrorTrackerIssues,
            currentProject,
            errorTracker,
            componentId,
            startDate,
            endDate,
        } = this.props;
        fetchErrorTrackerIssues(
            currentProject._id,
            componentId,
            errorTracker._id,
            skip,
            limit,
            startDate,
            endDate
        );
    };
    componentDidMount() {
        const {
            fetchErrorTrackerIssues,
            currentProject,
            errorTracker,
            componentId,
            startDate,
            endDate,
        } = this.props;
        fetchErrorTrackerIssues(
            currentProject._id,
            componentId,
            errorTracker._id,
            0,
            10,
            startDate,
            endDate
        );
        if (!this.props.currentProject) {
            const projectId = history.location.pathname
                .split('project/')[1]
                .split('/')[0];
            this.props.subProjectTeamLoading(projectId);
        } else {
            this.props.subProjectTeamLoading(this.props.currentProject._id);
        }
    }
    render() {
        const {
            errorTracker,
            errorTrackerIssue,
            isDetails,
            componentId,
            currentProject,
            openModal,
            teamMembers,
            showComponentWithIssue,
        } = this.props;
        const { deleteModalId, trackerKeyModalId } = this.state;
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
                                        />
                                    </ShouldRender>
                                    <ShouldRender if={errorTracker.editMode}>
                                        <NewErrorTracker
                                            edit={errorTracker.editMode}
                                            errorTracker={errorTracker}
                                            index={errorTracker._id}
                                            componentId={componentId}
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
ErrorTrackerDetail.displayName = 'ErrorTrackerDetail';
ErrorTrackerDetail.propTypes = {
    errorTracker: PropTypes.object,
    fetchErrorTrackerIssues: PropTypes.func,
    currentProject: PropTypes.object,
    componentId: PropTypes.string,
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
};
const mapDispatchToProps = dispatch => {
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
        },
        dispatch
    );
};
function mapStateToProps(state, ownProps) {
    const errorTrackerId = ownProps.index;
    const errorTrackers = state.errorTracker.errorTrackersList.errorTrackers;
    const currentErrorTracker = errorTrackers.filter(
        errorTracker => errorTracker._id === errorTrackerId
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
        subProjectTeamMember =>
            subProjectTeamMember._id === state.project.currentProject._id
    );
    return {
        errorTracker: currentErrorTracker[0],
        currentProject: state.project.currentProject,
        errorTrackerIssue,
        editMode: currentErrorTracker[0].editMode,
        startDate,
        endDate,
        teamMembers: teamMembers ? teamMembers.teamMembers : [],
    };
}
export default connect(mapStateToProps, mapDispatchToProps)(ErrorTrackerDetail);
