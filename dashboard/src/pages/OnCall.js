import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import Dashboard from '../components/Dashboard';
import { fetchProjectSchedule, fetchSubProjectSchedules, createSchedule, paginate } from '../actions/schedule';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import Badge from '../components/common/Badge';
import ScheduleProjectBox from '../components/schedule/ScheduleProjectBox';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject'

export class OnCall extends Component {

    constructor(props){
        super(props);
        this.state = { scheduleModalId: uuid.v4()}
    }

    ready(){
        const { subProjectSchedules, fetchSubProjectSchedules, currentProjectId } = this.props;
        if (subProjectSchedules.length === 0 && currentProjectId) {
            fetchSubProjectSchedules(currentProjectId);
        }
        if(window.location.href.indexOf('localhost') <= -1){
            this.context.mixpanel.track('Call Schedule Page Loaded');
        }
    }

    componentDidMount() {
        if (this.props.currentProjectId) {
			this.props.fetchSubProjectSchedules(this.props.currentProjectId).then(()=>{
                this.ready();
            });
		}
    }

    componentWillUnmount() {
        this.props.paginate('reset');
    }

    prevClicked = (subProjectId, skip, limit) => {
        const { fetchProjectSchedule, paginate } = this.props;

        fetchProjectSchedule(subProjectId, ((skip || 0) > (limit || 10)) ? skip - limit : 0, 10);
        paginate('prev');
        if(window.location.href.indexOf('localhost') <= -1){
            this.context.mixpanel.track('Fetch Previous Webhook');
        }
    }

    nextClicked = (subProjectId, skip, limit) => {
        const { fetchProjectSchedule, paginate } = this.props;

        fetchProjectSchedule(subProjectId, skip + limit, 10);
        paginate('next');
        if(window.location.href.indexOf('localhost') <= -1){
            this.context.mixpanel.track('Fetch Next Webhook');
        }
    }

    createSchedule = (subProjectId) => {
        const { createSchedule, currentProjectId, history } = this.props;

        createSchedule(subProjectId, { name: 'Unnamed' }).then(({ data }) => {
            history.push(`/project/${currentProjectId}/subProject/${subProjectId}/schedule/${data[0]._id}`);
        });
        if(window.location.href.indexOf('localhost') <= -1){
            this.context.mixpanel.track('New Schedule Created',{subProjectId, name: 'Unnamed' });
        }
    }

    handleKeyBoard = (e)=>{
        const schedulesPerPage = 10;
        let { subProjectSchedules, pages } = this.props;
        const canPaginateForward = subProjectSchedules.data ? subProjectSchedules.data.length >= (pages.counter + 1) * schedulesPerPage : null;
        const canPaginateBackward = pages.counter > 1;
        switch(e.key){
            case 'ArrowRight':
            return canPaginateForward && this.props.paginate('next')
            case 'ArrowLeft':
            return canPaginateBackward && this.props.paginate('prev')
			default:
			return false;
		}
	}

    render() {
        let {isRequesting, subProjectSchedules, subProjects, currentProject } = this.props;
        
        // SubProject Schedules List
        const allSchedules = subProjects && subProjects.map((subProject, i)=>{
            const subProjectSchedule = subProjectSchedules.find(subProjectSchedule => subProjectSchedule._id === subProject._id)
            let { count, skip, limit } = subProjectSchedule;
            skip = parseInt(skip);
            limit = parseInt(limit);
            const schedules = subProjectSchedule.schedules;
            let canPaginateForward = (subProjectSchedule && count) && (count > (skip + limit)) ? true : false;
            let canPaginateBackward = (subProjectSchedule && skip <= 0) ? false : true;
            const numberOfSchedules = schedules.length;

            if (subProjectSchedule && (isRequesting || !schedules)) {
                canPaginateForward = false;
                canPaginateBackward = false;
            }
            return subProjectSchedule && subProjectSchedule.schedules ? (
                <RenderIfUserInSubProject subProjectId={ subProjectSchedule._id }>
                   <div className="bs-BIM" key={i}>
                            <div className="Box-root Margin-bottom--12">
                                <div className="bs-ContentSection Card-root Card-shadow--medium">
                                    { 
                                        <div className="Box-root Padding-top--20 Padding-left--20">
                                            <Badge color={'blue'}>{subProject.name}</Badge>
                                        </div>
                                    }
                                    <ScheduleProjectBox
                                        projectId = {subProject._id}
                                        currentProject = {currentProject}
                                        schedules = {schedules}
                                        isRequesting = {isRequesting}
                                        count = {count}
                                        skip = {skip}
                                        limit = {limit}
                                        numberOfSchedules = {numberOfSchedules}
                                        subProjectSchedule = {subProjectSchedule}
                                        subProjectName = {subProject.name}
                                        scheduleModalId = {this.state.scheduleModalId}
                                        openModal = {this.props.openModal}
                                        subProject = {subProject}
                                        prevClicked = {this.prevClicked}
                                        nextClicked = {this.nextClicked}
                                        canPaginateBackward = {canPaginateBackward}
                                        canPaginateForward = {canPaginateForward}
                                        />
                                </div>
                            </div>
                        </div>
                    </RenderIfUserInSubProject>
                ) : false;
            });

        // Add Project Schedules to All Schedules List
        const currentProjectId = currentProject ? currentProject._id : null;
        var projectSchedule = subProjectSchedules && subProjectSchedules.find(subProjectSchedule => subProjectSchedule._id === currentProjectId)
        let { count, skip, limit } = projectSchedule || {};
        skip = parseInt(skip);
        limit = parseInt(limit);
        const schedules = projectSchedule ? projectSchedule.schedules : [];
        let canPaginateForward = (projectSchedule && count) && (count > (skip + limit)) ? true : false;
        let canPaginateBackward = (projectSchedule && skip <= 0) ? false : true;
        const numberOfSchedules = schedules.length;

        if (projectSchedule && (isRequesting || !schedules)) {
            canPaginateForward = false;
            canPaginateBackward = false;
        }
        projectSchedule = projectSchedule && projectSchedule.schedules ? (
            <RenderIfUserInSubProject subProjectId={ currentProject._id }>
                <div className="bs-BIM">
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                { 
                                    <div className="Box-root Padding-top--20 Padding-left--20">
                                        <Badge color={'red'}>Project</Badge>
                                    </div>
                                }
                                <ScheduleProjectBox
                                    projectId = {currentProject._id}
                                    currentProject = {currentProject}
                                    schedules = {schedules}
                                    isRequesting = {isRequesting}
                                    count = {count}
                                    skip = {skip}
                                    limit = {limit}
                                    numberOfSchedules = {numberOfSchedules}
                                    subProjectSchedule = {projectSchedule}
                                    subProjectName = {currentProject.name}
                                    scheduleModalId = {this.state.scheduleModalId}
                                    openModal = {this.props.openModal}
                                    subProject = {currentProject}
                                    prevClicked = {this.prevClicked}
                                    nextClicked = {this.nextClicked}
                                    canPaginateBackward = {canPaginateBackward}
                                    canPaginateForward = {canPaginateForward}
                                    />
                            </div>
                        </div>
                    </div>
                </RenderIfUserInSubProject>
            ) : false;

            allSchedules && allSchedules.unshift(projectSchedule)
            return(
            <Dashboard>
                <div tabIndex='0' onKeyDown={this.handleKeyBoard} className="db-World-contentPane Box-root Padding-bottom--48">
                    <div>
                        <div>
                            { 
                                allSchedules
                            }
                        </div>
                    </div>
                </div>
            </Dashboard>
        )
    }
}

const mapDispatchToProps = dispatch => (
    bindActionCreators({ openModal, closeModal, fetchProjectSchedule, createSchedule, paginate, fetchSubProjectSchedules }, dispatch)
)

const mapStateToProps = (state, props) => {
    const { projectId } = props.match.params;
    var subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames = subProjects && subProjects.map(subProject => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects = subProjectNames && subProjectNames.map(name => subProjects.find(subProject=>subProject.name === name))
    
    const currentProjectId = projectId;
    var schedules = state.schedule.subProjectSchedules;

    // find project schedules or assign default value
    var projectSchedule = schedules.find(schedule => schedule._id === currentProjectId);
    projectSchedule = projectSchedule ? projectSchedule : { _id: currentProjectId , schedules: [], count: 0, skip: 0, limit: 10 };
    
    // find subproject schedules or assign default value
    var subProjectSchedules = subProjects && subProjects.map(subProject=> {
        var schedule = schedules.find(schedule => schedule._id === subProject._id);
        return schedule ? schedule : {_id: subProject._id, schedules: [], count: 0, skip: 0, limit: 10};
    });
    subProjectSchedules && subProjectSchedules.unshift(projectSchedule);
    return {
        currentProjectId,
        subProjectSchedules,
        isRequesting: state.schedule.schedules.requesting,
        pages: state.schedule.pages,
        projectId,
        subProjects,
        currentProject: state.project.currentProject
    }
}

OnCall.propTypes = {
    subProjectSchedules: PropTypes.array.isRequired,
    subProjects: PropTypes.array.isRequired,
    fetchProjectSchedule: PropTypes.func.isRequired,
    fetchSubProjectSchedules: PropTypes.func.isRequired,
    history: PropTypes.object.isRequired,
    currentProjectId: PropTypes.string.isRequired,
    isRequesting: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.oneOf([null, undefined])
    ]),
    paginate: PropTypes.func.isRequired,
    createSchedule: PropTypes.func.isRequired,
    pages: PropTypes.object.isRequired,
    openModal: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
}

OnCall.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

OnCall.displayName = 'OnCall'

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(OnCall));