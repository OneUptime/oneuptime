import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { fetchErrorTrackerIssues } from '../../actions/errorTracker';
import { bindActionCreators } from 'redux';
import ErrorTrackerHeader from './ErrorTrackerHeader';
import ErrorTrackerDetailView from './ErrorTrackerDetailView';

class ErrorTrackerDetail extends Component {
    componentDidMount() {
        const {
            fetchErrorTrackerIssues,
            currentProject,
            errorTracker,
            componentId,
        } = this.props;
        fetchErrorTrackerIssues(
            currentProject._id,
            componentId,
            errorTracker._id,
            0,
            10
        );
    }
    render() {
        const { errorTracker, errorTrackerIssue } = this.props;
        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <ErrorTrackerHeader
                                    errorTracker={errorTracker}
                                    errorTrackerIssue={errorTrackerIssue}
                                    isDetails={false}
                                />
                                <div>
                                    <ErrorTrackerDetailView
                                        errorTracker={errorTracker}
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
ErrorTrackerDetail.displayName = 'ErrorTrackerDetail';
ErrorTrackerDetail.propTypes = {
    errorTracker: PropTypes.object,
    fetchErrorTrackerIssues: PropTypes.func,
    currentProject: PropTypes.object,
    componentId: PropTypes.string,
    errorTrackerIssue: PropTypes.object,
};
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchErrorTrackerIssues,
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
    return {
        errorTracker: currentErrorTracker[0],
        currentProject: state.project.currentProject,
        errorTrackerIssue,
    };
}
export default connect(mapStateToProps, mapDispatchToProps)(ErrorTrackerDetail);
