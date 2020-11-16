import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import {
    fetchErrorTrackerIssues,
    deleteErrorTracker,
    editErrorTrackerSwitch,
} from '../../actions/errorTracker';
import { bindActionCreators } from 'redux';
import ErrorTrackerHeader from './ErrorTrackerHeader';
import ErrorTrackerDetailView from './ErrorTrackerDetailView';
import { history } from '../../store';
import { openModal } from '../../actions/modal';
import uuid from 'uuid';
import ShouldRender from '../basic/ShouldRender';
import NewErrorTracker from './NewErrorTracker';

class ErrorTrackerDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            deleteModalId: uuid.v4(),
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
        const {
            errorTracker,
            errorTrackerIssue,
            isDetails,
            componentId,
            currentProject,
            openModal,
        } = this.props;
        const { deleteModalId } = this.state;
        if (errorTracker) {
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
};
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchErrorTrackerIssues,
            deleteErrorTracker,
            openModal,
            editErrorTrackerSwitch,
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
        editMode: currentErrorTracker[0].editMode,
    };
}
export default connect(mapStateToProps, mapDispatchToProps)(ErrorTrackerDetail);
