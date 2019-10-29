import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
import ProjectDetails from '../components/project/ProjectDetails';
import ProjectDeleteBox from '../components/project/ProjectDeleteBox';
import ProjectRestoreBox from '../components/project/ProjectRestoreBox';
import ProjectBlockBox from '../components/project/ProjectBlockBox';
import ProjectUnblockBox from '../components/project/ProjectUnblockBox';
import AdminNotes from '../components/adminNote/AdminNotes';
import { addProjectNote, fetchProject } from '../actions/project';

class Project extends Component {

    componentDidMount() {
        if(window.location.href.indexOf('localhost') <= -1){
        this.context.mixpanel.track('Project page Loaded');
        }
    }

    ready = () => {
        const { fetchProject } = this.props;

        fetchProject(this.props.match.params.projectId);
    }

    render() {
        return (
            <Dashboard ready={this.ready}>
                <div className="db-World-contentPane Box-root Padding-bottom--48">

                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span data-reactroot="">
                                        <div>
                                            <div className="Box-root Margin-bottom--12">
                                                <ProjectDetails />
                                            </div>
                                            <div className="Box-root Margin-bottom--12">
                                            <AdminNotes id={this.props.project ? this.props.project._id : ''} addNote={this.props.addProjectNote} initialValues={this.props.initialValues} />
                                            </div>
                                            <ShouldRender if={this.props.project && !this.props.project.deleted && !this.props.project.isBlocked}>
                                                <div className="Box-root Margin-bottom--12">
                                                    <ProjectBlockBox />
                                                </div>
                                            </ShouldRender>
                                            <ShouldRender if={this.props.project && !this.props.project.deleted && this.props.project.isBlocked}>
                                                <div className="Box-root Margin-bottom--12">
                                                    <ProjectUnblockBox />
                                                </div>
                                            </ShouldRender>
                                            <ShouldRender if={this.props.project && !this.props.project.deleted}>
                                                <div className="Box-root Margin-bottom--12">
                                                    <ProjectDeleteBox />
                                                </div>
                                            </ShouldRender>
                                            <ShouldRender if={this.props.project && this.props.project.deleted}>
                                                <div className="Box-root Margin-bottom--12">
                                                    <ProjectRestoreBox />
                                                </div>
                                            </ShouldRender>
                                        </div>
                                    </span>
                                </div>
                            </div>
                    </div>
                </div>
            </div>
        </Dashboard>
        );
    }
}

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ addProjectNote, fetchProject }, dispatch)
}

const mapStateToProps = (state) => {
    const project = state.project.project.project || {}
    return {
        project,
        adminNote: state.adminNote,
        initialValues: { adminNotes: project.adminNotes || []}
    }
}

Project.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

Project.propTypes = {
    addProjectNote: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
    match: PropTypes.object.isRequired,
    fetchProject: PropTypes.func.isRequired,
    project: PropTypes.object.isRequired
}

Project.displayName = 'Project'

export default connect(mapStateToProps, mapDispatchToProps)(Project);
