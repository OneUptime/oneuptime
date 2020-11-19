import React, { Component } from 'react';
import ErrorEventHeader from './ErrorEventHeader';
import ErrorEventDevice from './ErrorEventDevice';
import ErrorEventMiniTag from './ErrorEventMiniTag';
import ErrorEventStackTrace from './ErrorEventStackTrace';
import ErrorEventTimeline from './ErrorEventTimeline';
import ErrorEventInfoSection from './ErrorEventInfoSection';
import PropTypes from 'prop-types';
import { ignoreErrorEventByIssue } from '../../actions/errorTracker';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';

class ErrorEventDetail extends Component {
    ignoreErrorEvent = issueId => {
        const {
            projectId,
            componentId,
            errorTrackerId,
            ignoreErrorEventByIssue,
        } = this.props;
        ignoreErrorEventByIssue(projectId, componentId, errorTrackerId, [
            issueId,
        ]);
    };
    render() {
        const { errorEvent, navigationLink, errorTrackerIssue } = this.props;
        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <div className="Padding-all--20">
                                    <ErrorEventHeader
                                        errorEvent={errorEvent}
                                        errorTrackerIssue={errorTrackerIssue}
                                        navigationLink={navigationLink}
                                        ignoreErrorEvent={this.ignoreErrorEvent}
                                    />
                                    <ErrorEventDevice errorEvent={errorEvent} />
                                    <ErrorEventMiniTag
                                        errorEvent={errorEvent}
                                    />
                                    <ErrorEventStackTrace
                                        errorEvent={errorEvent}
                                    />
                                    <ErrorEventTimeline
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
            </div>
        );
    }
}
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            ignoreErrorEventByIssue,
        },
        dispatch
    );
};
const mapStateToProps = (state, ownProps) => {
    const errorTrackerId = ownProps.errorTrackerId;
    const errorTrackers = state.errorTracker.errorTrackersList.errorTrackers;
    const currentErrorTracker = errorTrackers.filter(
        errorTracker => errorTracker._id === errorTrackerId
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
            errorTrackerIssue =>
                errorTrackerIssue._id === errorEvent.issueId._id
        )[0];
    }
    const errorTrackerIssueStatus = errorEventIssue
        ? errorEventIssue
        : errorEvent
        ? errorEvent.issueId
        : {};

    return {
        errorTracker: currentErrorTracker[0],
        currentProject: state.project.currentProject,
        errorTrackerIssue: errorTrackerIssueStatus,
        ignored: errorTrackerIssueStatus.ignored,
    };
};
ErrorEventDetail.propTypes = {
    errorEvent: PropTypes.object,
    navigationLink: PropTypes.func,
    ignoreErrorEventByIssue: PropTypes.func,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    errorTrackerId: PropTypes.string,
    errorTrackerIssue: PropTypes.object,
};
ErrorEventDetail.displayName = 'ErrorEventDetail';
export default connect(mapStateToProps, mapDispatchToProps)(ErrorEventDetail);
