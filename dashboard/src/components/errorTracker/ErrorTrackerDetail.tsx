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
import { bindActionCreators, Dispatch } from 'redux';
import ErrorTrackerHeader from './ErrorTrackerHeader';
import ErrorTrackerDetailView from './ErrorTrackerDetailView';
import { history } from '../../store';
import { openModal, closeModal } from 'common-ui/actions/modal';

import { v4 as uuidv4 } from 'uuid';
import ShouldRender from '../basic/ShouldRender';
import NewErrorTracker from './NewErrorTracker';

import moment from 'moment';
import ErrorEventUtil from '../../utils/ErrorEventUtil';
import { socket } from '../basic/Socket';

interface ErrorTrackerDetailProps {
    errorTracker?: object;
    fetchErrorTrackerIssues?: Function;
    currentProject?: object;
    componentId?: string;
    componentSlug?: string;
    errorTrackerIssue?: object;
    isDetails?: boolean;
    deleteErrorTracker?: Function;
    openModal?: Function;
    editErrorTrackerSwitch?: Function;
    resetErrorTrackerKey?: Function;
    closeModal?: Function;
    startDate?: string;
    endDate?: string;
    ignoreErrorEvent?: Function;
    resolveErrorEvent?: Function;
    updateErrorEventMember?: Function;
    subProjectTeamLoading?: Function;
    teamMembers?: unknown[];
    showComponentWithIssue?: boolean;
    getErrorEventSuccess?: Function;
}

class ErrorTrackerDetail extends Component<ErrorTrackerDetailProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {
            deleteModalId: uuidv4(),
            trackerKeyModalId: uuidv4(),
            filters: null,
        };
    }
    viewMore = () => {

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
        });
    };
    deleteErrorTracker = () => {
        const {

            currentProject,

            componentId,

            componentSlug,

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
            currentProject.slug +
            '/component/' +
            componentSlug +
            '/error-tracker'
        );
        return promise;
    };
    editErrorTracker = () => {

        const { editErrorTrackerSwitch, errorTracker } = this.props;
        editErrorTrackerSwitch(errorTracker._id);
    };
    ignoreErrorEvent = (issues: $TSFixMe, ignore: $TSFixMe) => {
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
            issues,
            ignore
        );
    };
    updateErrorEventMember = (issueId: $TSFixMe, userId: $TSFixMe, type: $TSFixMe) => {
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
    resolveErrorEvent = (issues: $TSFixMe) => {
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
    handleStartDateTimeChange = (val: $TSFixMe) => {
        const startDate = moment(val);

        this.fetchByDateChange(startDate, this.props.endDate);
    };
    handleEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);

        this.fetchByDateChange(this.props.startDate, endDate);
    };
    handleFilterUpdate = (val: $TSFixMe) => {
        const filters = ErrorEventUtil.generateFilterOption(val);
        this.setState(() => ({
            filters: filters,
        }));
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
    fetchByDateChange = (startDate: $TSFixMe, endDate: $TSFixMe) => {
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
                endDate,

                this.state.filters
            );
        }
    };
    handleNavigationButtonClick = (skip: $TSFixMe, limit: $TSFixMe) => {
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
            endDate,

            this.state.filters
        );
    };
    override componentDidMount() {
        const {

            fetchErrorTrackerIssues,

            currentProject,

            errorTracker,

            componentId,

            startDate,

            endDate,

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

            showComponentWithIssue ? { resolved: false } : this.state.filters
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
    override componentWillUnmount() {
        socket.removeListener(

            `createErrorEvent-${this.props.errorTracker._id}`
        );
    }
    override render() {
        const {

            errorTracker,

            errorTrackerIssue,

            isDetails,

            componentId,

            currentProject,

            componentSlug,

            openModal,

            teamMembers,

            showComponentWithIssue,
        } = this.props;

        const { deleteModalId, trackerKeyModalId } = this.state;

        if (errorTracker) {
            // join room
            socket.emit('error_tracker_switch', errorTracker._id);

            socket.on(`createErrorEvent-${errorTracker._id}`, (data: $TSFixMe) => {

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

ErrorTrackerDetail.displayName = 'ErrorTrackerDetail';

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
const mapDispatchToProps = (dispatch: Dispatch) => {
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
