import React, { Component } from 'react';
import ErrorEventHeader from './ErrorEventHeader';
import ErrorEventMiniTag from './ErrorEventMiniTag';
import ErrorEventStackTrace from './ErrorEventStackTrace';
import ErrorEventTimeline from './ErrorEventTimeline';
import ErrorEventInfoSection from './ErrorEventInfoSection';
import PropTypes from 'prop-types';
import {
    ignoreErrorEvent,
    unresolveErrorEvent,
    resolveErrorEvent,
    deleteErrorTrackerIssue,
} from '../../actions/errorTracker';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Notification from '../basic/Notification';
import ShouldRender from '../basic/ShouldRender';
import ErrorTrackerIssueTimeline from './ErrorTrackerIssueTimeline';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import { openModal } from '../../actions/modal';
import DeleteErrorTrackerIssue from '../modals/DeleteErrorTrackerIssue';
import { history } from '../../store';

class ErrorEventDetail extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            deleteModalId: uuidv4(),
        };
    }
    ignoreErrorEvent = (issueId: $TSFixMe, unIgnore = false) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerId' does not exist on type '... Remove this comment to see the full error message
            errorTrackerId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ignoreErrorEvent' does not exist on type... Remove this comment to see the full error message
            ignoreErrorEvent,
        } = this.props;
        ignoreErrorEvent(
            projectId,
            componentId,
            errorTrackerId,
            [issueId],
            unIgnore
        );
    };
    unresolveErrorEvent = (issueId: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerId' does not exist on type '... Remove this comment to see the full error message
            errorTrackerId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'unresolveErrorEvent' does not exist on t... Remove this comment to see the full error message
            unresolveErrorEvent,
        } = this.props;
        unresolveErrorEvent(projectId, componentId, errorTrackerId, [issueId]);
    };
    resolveErrorEvent = (issueId: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerId' does not exist on type '... Remove this comment to see the full error message
            errorTrackerId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveErrorEvent' does not exist on typ... Remove this comment to see the full error message
            resolveErrorEvent,
        } = this.props;
        resolveErrorEvent(projectId, componentId, errorTrackerId, [issueId]);
    };
    openDeleteModal = (issue: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteModalId' does not exist on type 'R... Remove this comment to see the full error message
            id: this.state.deleteModalId,
            onClose: () => '',
            onConfirm: () => this.deleteErrorTrackerIssue(issue),
            content: DataPathHoC(DeleteErrorTrackerIssue, { issue }),
        });
    };
    deleteErrorTrackerIssue = (issue: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerId' does not exist on type '... Remove this comment to see the full error message
            errorTrackerId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerSlug' does not exist on type... Remove this comment to see the full error message
            errorTrackerSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteErrorTrackerIssue' does not exist ... Remove this comment to see the full error message
            deleteErrorTrackerIssue,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
        } = this.props;
        const promise = deleteErrorTrackerIssue(
            projectId,
            componentId,
            errorTrackerId,
            issue._id
        );
        history.push(
            `/dashboard/project/${currentProject.slug}/component/${componentSlug}/error-trackers/${errorTrackerSlug}`
        );

        return promise;
    };
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorEvent' does not exist on type 'Read... Remove this comment to see the full error message
            errorEvent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'navigationLink' does not exist on type '... Remove this comment to see the full error message
            navigationLink,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerIssue' does not exist on typ... Remove this comment to see the full error message
            errorTrackerIssue,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerStatus' does not exist on ty... Remove this comment to see the full error message
            errorTrackerStatus,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerState' does not exist on typ... Remove this comment to see the full error message
            errorTrackerState,
        } = this.props;
        return (
            <div className="bs-BIM">
                <ShouldRender if={errorTrackerIssue.ignored}>
                    <Notification
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                        backgroundClass="Box-background--red4"
                        icon="db-SideNav-icon--warning"
                        message={
                            <span>This issue has been marked as ignored.</span>
                        }
                    />
                </ShouldRender>
                <ShouldRender if={errorTrackerIssue.resolved}>
                    <Notification
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                        backgroundClass="Box-background--green"
                        message={
                            <span>This issue has been marked as resolved.</span>
                        }
                    />
                </ShouldRender>
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <div className="Padding-all--20">
                                    <ErrorEventHeader
                                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                                        errorEvent={errorEvent}
                                        errorTrackerIssue={errorTrackerIssue}
                                        navigationLink={navigationLink}
                                        ignoreErrorEvent={this.ignoreErrorEvent}
                                        unresolveErrorEvent={
                                            this.unresolveErrorEvent
                                        }
                                        resolveErrorEvent={
                                            this.resolveErrorEvent
                                        }
                                        errorTrackerStatus={errorTrackerStatus}
                                        openDeleteModal={this.openDeleteModal}
                                        errorTrackerState={errorTrackerState}
                                    />
                                    <ErrorEventMiniTag
                                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                                        errorEvent={errorEvent}
                                    />
                                    <ErrorEventStackTrace
                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ errorEvent: any; }' is not assignable to t... Remove this comment to see the full error message
                                        errorEvent={errorEvent}
                                    />

                                    <ErrorEventInfoSection
                                        errorEvent={errorEvent}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ errorEvent: any; }' is not assignable to t... Remove this comment to see the full error message
                <ErrorEventTimeline errorEvent={errorEvent} />
                <ErrorTrackerIssueTimeline
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ errorEvent: any; errorTrackerIssue: any; }... Remove this comment to see the full error message
                    errorEvent={errorEvent}
                    errorTrackerIssue={errorTrackerIssue}
                />
            </div>
        );
    }
}
const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            ignoreErrorEvent,
            unresolveErrorEvent,
            resolveErrorEvent,
            openModal,
            deleteErrorTrackerIssue,
        },
        dispatch
    );
};
const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const errorTrackerId = ownProps.errorTrackerId;
    const errorTrackers = state.errorTracker.errorTrackersList.errorTrackers;
    const currentErrorTracker = errorTrackers.filter(
        (errorTracker: $TSFixMe) => errorTracker._id === errorTrackerId
    );
    const errorTrackerIssues = state.errorTracker.errorTrackerIssues[
        errorTrackerId
    ]
        ? state.errorTracker.errorTrackerIssues[errorTrackerId]
              .errorTrackerIssues
        : [];
    const errorEvent = ownProps.errorEvent.errorEvent;
    // check if issue id exist in the redux state first, before using the issue details in the error event
    let errorEventIssue;
    if (errorEvent) {
        errorEventIssue = errorTrackerIssues.filter(
            (errorTrackerIssue: $TSFixMe) => errorTrackerIssue._id === errorEvent.issueId._id
        )[0];
    }
    const errorTrackerIssueStatus = errorEventIssue
        ? errorEventIssue
        : errorEvent
        ? errorEvent.issueId
        : {};

    const errorTrackerStatus =
        state.errorTracker.errorTrackerStatus[ownProps.errorTrackerId];

    return {
        errorTracker: currentErrorTracker[0],
        currentProject: state.project.currentProject,
        errorTrackerIssue: errorTrackerIssueStatus,
        ignored: errorTrackerIssueStatus.ignored,
        resolved: errorTrackerIssueStatus.resolved,
        timeline: errorTrackerIssueStatus.timeline,
        errorTrackerStatus,
        errorTrackerState: state.errorTracker,
    };
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ErrorEventDetail.propTypes = {
    errorEvent: PropTypes.object,
    navigationLink: PropTypes.func,
    ignoreErrorEvent: PropTypes.func,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    errorTrackerId: PropTypes.string,
    errorTrackerSlug: PropTypes.string,
    errorTrackerIssue: PropTypes.object,
    unresolveErrorEvent: PropTypes.func,
    resolveErrorEvent: PropTypes.func,
    errorTrackerStatus: PropTypes.object,
    openModal: PropTypes.func,
    errorTrackerState: PropTypes.object,
    deleteErrorTrackerIssue: PropTypes.func,
    currentProject: PropTypes.object,
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ErrorEventDetail.displayName = 'ErrorEventDetail';
export default connect(mapStateToProps, mapDispatchToProps)(ErrorEventDetail);
