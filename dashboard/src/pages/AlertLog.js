import React, { Component } from 'react';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import { fetchAlert, fetchProjectAlert } from '../actions/alert';
import PropTypes from 'prop-types';
import AlertProjectBox from '../components/alert/AlertProjectBox'
import Badge from '../components/common/Badge';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject'
import ShouldRender from '../components/basic/ShouldRender';
import uuid from 'uuid';

class AlertLog extends Component {

    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Alert Log Loaded');
        }
    }

    ready = () => {
        this.props.fetchAlert(this.props.currentProject._id);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Project Ready', { projectId: this.props.currentProject._id });
        }
    }

    prevClicked = (projectId, skip, limit) => {
        this.props.fetchProjectAlert(projectId, ((skip || 0) > (limit || 10)) ? this.props.alerts.skip - this.props.alerts.limit : 0, 10);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Fetch Previous Alert');
        }
    }

    nextClicked = (projectId, skip, limit) => {
        this.props.fetchProjectAlert(projectId, skip + limit, 10);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Fetch Next Alert');
        }
    }

    render() {
        const { subProjects, currentProject, isRequesting, error } = this.props;
        // SubProject Alert List
        const allAlerts = subProjects && subProjects.map((subProject, i) => {
            const subProjectAlert = this.props.alerts.data && this.props.alerts.data.length > 0 && this.props.alerts.data.find(subProjectAlert => subProjectAlert._id === subProject._id)
            if (subProjectAlert && subProjectAlert.count && typeof subProjectAlert.count === 'string') {
                subProjectAlert.count = parseInt(subProjectAlert.count, 10);
            }
            if (subProjectAlert && subProjectAlert.skip && typeof subProjectAlert.skip === 'string') {
                subProjectAlert.skip = parseInt(subProjectAlert.skip, 10);
            }
            if (subProjectAlert && subProjectAlert.limit && typeof subProjectAlert.limit === 'string') {
                subProjectAlert.limit = parseInt(subProjectAlert.limit, 10);
            }
            let canNext = (subProjectAlert && subProjectAlert.count) && subProjectAlert.count > subProjectAlert.skip + subProjectAlert.limit ? true : false;
            let canPrev = (subProjectAlert && subProjectAlert.skip <= 0) ? false : true;

            if (this.props.alerts && (this.props.alerts.requesting || !this.props.alerts.data)) {
                canNext = false;
                canPrev = false;
            }
            return subProjectAlert && subProjectAlert.alerts ? (
                <RenderIfUserInSubProject subProjectId={subProjectAlert._id} key={i}>
                    <div className="bs-BIM" key={i}>
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <ShouldRender if={subProjects.length > 0}>
                                    <div className="Box-root Padding-top--20 Padding-left--20">
                                        <Badge color={'blue'}>{subProject.name}</Badge>
                                    </div>
                                </ShouldRender>
                                <AlertProjectBox
                                    subProjectAlert={subProjectAlert}
                                    subProjectName={subProject.name}
                                    currentProjectId={currentProject._id}
                                    prevClicked={this.prevClicked}
                                    nextClicked={this.nextClicked}
                                    canNext={canNext}
                                    canPrev={canPrev}
                                    isRequesting={isRequesting}
                                    error={error}
                                />
                            </div>
                        </div>
                    </div>
                </RenderIfUserInSubProject>

            ) : false;
        });

        // Add Project Alerts to All Alerts List
        var projectAlert = this.props.alerts.data && this.props.alerts.data.length > 0 && this.props.alerts.data.find(projectAlert => projectAlert._id === currentProject._id)
        if (projectAlert && projectAlert.count && typeof projectAlert.count === 'string') {
            projectAlert.count = parseInt(projectAlert.count, 10);
        }
        if (projectAlert && projectAlert.skip && typeof projectAlert.skip === 'string') {
            projectAlert.skip = parseInt(projectAlert.skip, 10);
        }
        if (projectAlert && projectAlert.limit && typeof projectAlert.limit === 'string') {
            projectAlert.limit = parseInt(projectAlert.limit, 10);
        }
        let canNext = (projectAlert && projectAlert.count) && projectAlert.count > projectAlert.skip + projectAlert.limit ? true : false;
        let canPrev = (projectAlert && projectAlert.skip <= 0) ? false : true;

        if (this.props.alerts && (this.props.alerts.requesting || !this.props.alerts.data)) {
            canNext = false;
            canPrev = false;
        }
        projectAlert = projectAlert && projectAlert.alerts ? (
            <RenderIfUserInSubProject subProjectId={projectAlert._id} key={() => uuid.v4()}>
                <div className="bs-BIM">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <ShouldRender if={subProjects.length > 0}>
                                <div className="Box-root Padding-top--20 Padding-left--20">
                                    <Badge color={'red'}>Project</Badge>
                                </div>
                            </ShouldRender>
                            <AlertProjectBox
                                subProjectAlert={projectAlert}
                                subProjectName={currentProject.name}
                                currentProjectId={currentProject._id}
                                prevClicked={this.prevClicked}
                                nextClicked={this.nextClicked}
                                canNext={canNext}
                                canPrev={canPrev}
                                isRequesting={isRequesting}
                                error={error}
                                subProjects={subProjects}
                            />
                        </div>
                    </div>
                </div>
            </RenderIfUserInSubProject>

        ) : false;
        allAlerts && allAlerts.unshift(projectAlert)
        return (
            <Dashboard ready={this.ready}>
                <div className="Box-root">
                    <div>
                        <div>
                            <div className="Margin-vertical--12">
                                {allAlerts}
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard >
        )
    }
}

const mapDispatchToProps = dispatch => (
    bindActionCreators({ fetchAlert, fetchProjectAlert }, dispatch)
)

const mapStateToProps = (state) => {
    var subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames = subProjects && subProjects.map(subProject => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects = subProjectNames && subProjectNames.map(name => subProjects.find(subProject => subProject.name === name))
    return {
        alerts: state.alert.alerts,
        isRequesting: state.alert.alerts.requesting,
        error: state.alert.alerts.error,
        currentProject: state.project.currentProject,
        subProjects
    }
}

AlertLog.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

AlertLog.propTypes = {
    fetchAlert: PropTypes.func,
    fetchProjectAlert: PropTypes.func,
    currentProject: PropTypes.object.isRequired,
    alerts: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined])
    ]),
    error: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined])
    ]),
    isRequesting: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.oneOf([null, undefined])
    ]),
    subProjects: PropTypes.array.isRequired,
}

AlertLog.displayName = 'AlertLog'

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(AlertLog));