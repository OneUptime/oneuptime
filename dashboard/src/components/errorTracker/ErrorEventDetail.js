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
    ignoreErrorEvent = (issueId, type) => {
        const {
            projectId,
            componentId,
            errorTrackerId,
            errorEvent,
            ignoreErrorEventByIssue,
        } = this.props;
        ignoreErrorEventByIssue(projectId, componentId, errorTrackerId, [
            issueId,
        ]);
    };
    render() {
        const { errorEvent, navigationLink } = this.props;
        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <div className="Padding-all--20">
                                    <ErrorEventHeader
                                        errorEvent={errorEvent}
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
    console.log(ownProps);
    const errorTrackerId = ownProps.index;
    const errorTrackers = state.errorTracker.errorTrackersList.errorTrackers;
    const currentErrorTracker = errorTrackers.filter(
        errorTracker => errorTracker._id === errorTrackerId
    );
    const errorTrackerIssue =
        state.errorTracker.errorTrackerIssues[errorTrackerId];
    return {
        errorTracker: currentErrorTracker[0],
        currentProject: state.project.currentProject,
        errorTrackerIssue,
    };
};
ErrorEventDetail.propTypes = {
    errorEvent: PropTypes.object,
    navigationLink: PropTypes.func,
    ignoreErrorEventByIssue: PropTypes.func,
};
ErrorEventDetail.displayName = 'ErrorEventDetail';
export default connect(mapStateToProps, mapDispatchToProps)(ErrorEventDetail);
