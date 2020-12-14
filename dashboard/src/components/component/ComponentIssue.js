import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { fetchComponentIssues } from '../../actions/component';
import { fetchErrorTrackers } from '../../actions/errorTracker';
import { ErrorTrackerList } from '../errorTracker/ErrorTrackerList';

class ComponentIssue extends Component {
    componentDidMount() {
        const { component, currentProjectId, fetchErrorTrackers } = this.props;
        fetchErrorTrackers(currentProjectId, component._id);
    }
    generateUrlLink(componentIssue) {
        const { currentProjectId, component } = this.props;
        return `/dashboard/project/${currentProjectId}/${component._id}/error-trackers/${componentIssue.errorTrackerId._id}`;
    }
    render() {
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
                        />
                    </div>
                </div>
            ) : (
                false
            );
        return <div>{errorTrackersList}</div>;
    }
}
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchComponentIssues,
            fetchErrorTrackers,
        },
        dispatch
    );
};
function mapStateToProps(state, ownProps) {
    const componentIssueList =
        state.component.componentIssueList[ownProps.component._id];
    const errorTrackers = state.errorTracker.errorTrackersList.errorTrackers.filter(
        errorTracker => errorTracker.componentId._id === ownProps.component._id
    );
    return {
        currentProject: state.project.currentProject,
        subProject: state.subProject,
        componentIssueList,
        errorTrackers,
    };
}
ComponentIssue.displayName = 'ComponentIssue';
ComponentIssue.propTypes = {
    currentProjectId: PropTypes.string.isRequired,
    component: PropTypes.object,
    fetchErrorTrackers: PropTypes.func,
    errorTrackers: PropTypes.array,
};
export default connect(mapStateToProps, mapDispatchToProps)(ComponentIssue);
