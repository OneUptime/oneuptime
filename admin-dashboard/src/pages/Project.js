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

class Project extends Component {

    componentDidMount() {
        if(window.location.href.indexOf('localhost') <= -1){
        this.context.mixpanel.track('Project page Loaded');
        }
    }

    ready = () => {
        if(!this.props.project){
            this.props.history.push('/projects');
        }
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
                                                <ProjectDetails projectId={this.props.project ? this.props.project._id : ''} />
                                            </div>
                                            <ShouldRender if={this.props.project && !this.props.project.deleted && !this.props.project.isBlocked}>
                                                <div className="Box-root Margin-bottom--12">
                                                    <ProjectBlockBox projectId={this.props.project ? this.props.project._id : ''} />
                                                </div>
                                            </ShouldRender>
                                            <ShouldRender if={this.props.project && !this.props.project.deleted && this.props.project.isBlocked}>
                                                <div className="Box-root Margin-bottom--12">
                                                    <ProjectUnblockBox projectId={this.props.project ? this.props.project._id : ''} />
                                                </div>
                                            </ShouldRender>
                                            <ShouldRender if={this.props.project && !this.props.project.deleted}>
                                                <div className="Box-root Margin-bottom--12">
                                                    <ProjectDeleteBox projectId={this.props.project ? this.props.project._id : ''} />
                                                </div>
                                            </ShouldRender>
                                            <ShouldRender if={this.props.project && this.props.project.deleted}>
                                                <div className="Box-root Margin-bottom--12">
                                                    <ProjectRestoreBox projectId={this.props.project ? this.props.project._id : ''} />
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
    return bindActionCreators({ }, dispatch)
}

const mapStateToProps = (state, props) => {
    const project = state.project.projects.projects.find(project => project._id === props.match.params.projectId);
    return {
        project
    }
}

Project.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

Project.propTypes = {
    history: PropTypes.object.isRequired,
}

Project.displayName = 'Project'

export default connect(mapStateToProps, mapDispatchToProps)(Project);
