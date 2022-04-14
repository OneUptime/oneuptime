import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { fetchComponentIssues } from '../../actions/component';
import { fetchErrorTrackers } from '../../actions/errorTracker';
import { ErrorTrackerList } from '../errorTracker/ErrorTrackerList';

interface ComponentIssueProps {
    currentProjectId: string;
    component?: object;
    currentProject: object;
    fetchErrorTrackers?: Function;
    errorTrackers?: unknown[];
    trackerSkip?: number;
    trackerLimit?: number;
}

class ComponentIssue extends Component<ComponentProps> {
    override componentDidMount() {
        const {

            component,

            currentProjectId,

            fetchErrorTrackers,

            trackerSkip,

            trackerLimit,
        } = this.props;
        fetchErrorTrackers(
            currentProjectId,
            component._id,
            trackerSkip,
            trackerLimit
        );
    }
    generateUrlLink(componentIssue: $TSFixMe) {

        const { component, currentProject } = this.props;
        return `/dashboard/project/${currentProject.slug}/component/${component._id}/error-trackers/${componentIssue.errorTrackerId.slug}`;
    }
    override render() {

        const { component, errorTrackers } = this.props;

        const errorTrackersList =
            errorTrackers && errorTrackers.length > 0 ? (
                <div
                    id={`box_${component._id}`}
                    className="Box-root Margin-vertical--12"
                >
                    <div
                        className="db-Trends Card-root"
                        style={{ overflow: 'visible' }}
                    >
                        <ErrorTrackerList
                            componentId={component._id}
                            errorTrackers={errorTrackers}
                            showComponentWithIssue={true}
                        />
                    </div>
                </div>
            ) : (
                false
            );
        return <div>{errorTrackersList}</div>;
    }
}
const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchComponentIssues,
            fetchErrorTrackers,
        },
        dispatch
    );
};
function mapStateToProps(state: RootState, ownProps: $TSFixMe) {
    const componentIssueList =
        state.component.componentIssueList[ownProps.component._id];
    const errorTrackers = state.errorTracker.errorTrackersList.errorTrackers.filter(
        (errorTracker: $TSFixMe) => errorTracker.componentId._id === ownProps.component._id
    );
    return {
        currentProject: state.project.currentProject,
        subProject: state.subProject,
        componentIssueList,
        errorTrackers,
        trackerSkip: state.errorTracker.errorTrackersList.skip || 0,
        trackerLimit: state.errorTracker.errorTrackersList.limit || 5,
    };
}

ComponentIssue.displayName = 'ComponentIssue';

ComponentIssue.propTypes = {
    currentProjectId: PropTypes.string.isRequired,
    component: PropTypes.object,
    currentProject: PropTypes.object.isRequired,
    fetchErrorTrackers: PropTypes.func,
    errorTrackers: PropTypes.array,
    trackerSkip: PropTypes.number,
    trackerLimit: PropTypes.number,
};
export default connect(mapStateToProps, mapDispatchToProps)(ComponentIssue);
