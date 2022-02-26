import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import {
    fetchProjectSchedule,
    fetchSubProjectSchedules,
    createSchedule,
    paginate,
} from '../actions/schedule';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import ScheduleProjectBox from '../components/schedule/ScheduleProjectBox';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { LoadingState } from '../components/basic/Loader';

export class OnCall extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { scheduleModalId: uuidv4() };
    }

    ready() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSubProjectSchedules' does not exist... Remove this comment to see the full error message
        const { fetchSubProjectSchedules, currentProjectId } = this.props;
        fetchSubProjectSchedules(currentProjectId);
    }

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
        if (this.props.currentProjectId) {
            this.ready();
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        if (prevProps.projectId !== this.props.projectId) {
            this.ready();
        }
    }

    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.paginate('reset');
    }

    prevClicked = (subProjectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectSchedule' does not exist on ... Remove this comment to see the full error message
        const { fetchProjectSchedule, paginate } = this.props;

        fetchProjectSchedule(
            subProjectId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        this.setState({ [subProjectId]: this.state[subProjectId] - 1 });
        paginate('prev');
    };

    nextClicked = (subProjectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectSchedule' does not exist on ... Remove this comment to see the full error message
        const { fetchProjectSchedule, paginate } = this.props;

        fetchProjectSchedule(subProjectId, skip + limit, 10);
        this.setState({
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            [subProjectId]: !this.state[subProjectId]
                ? 2
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                : this.state[subProjectId] + 1,
        });
        paginate('next');
    };

    createSchedule = (subProjectId: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSchedule' does not exist on type '... Remove this comment to see the full error message
        const { createSchedule, history } = this.props;

        createSchedule(subProjectId, { name: 'Unnamed' }).then(({
            data
        }: $TSFixMe) => {
            history.push(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                `/dashboard/project/${this.props.currentProject.slug}/schedule/${data[0].slug}`
            );
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        const schedulesPerPage = 10;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectSchedules' does not exist on t... Remove this comment to see the full error message
        const { subProjectSchedules, pages } = this.props;
        const canPaginateForward = subProjectSchedules.data
            ? subProjectSchedules.data.length >=
              (pages.counter + 1) * schedulesPerPage
            : null;
        const canPaginateBackward = pages.counter > 1;
        switch (e.key) {
            case 'ArrowRight':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
                return canPaginateForward && this.props.paginate('next');
            case 'ArrowLeft':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
                return canPaginateBackward && this.props.paginate('prev');
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectSchedules' does not exist on t... Remove this comment to see the full error message
            subProjectSchedules,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            subProjects,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
            currentProjectId,
        } = this.props;

        // Add Project Schedules to All Schedules List
        let projectSchedule =
            subProjectSchedules &&
            subProjectSchedules.find(
                (subProjectSchedule: $TSFixMe) => subProjectSchedule._id === currentProjectId
            );
        let { skip, limit } = projectSchedule || {};
        const { count } = projectSchedule || {};
        skip = parseInt(skip);
        limit = parseInt(limit);
        const schedules = projectSchedule ? projectSchedule.schedules : [];
        let canPaginateForward =
            projectSchedule && count && count > skip + limit ? true : false;
        let canPaginateBackward = projectSchedule && skip <= 0 ? false : true;
        const numberOfSchedules = schedules.length;

        if (projectSchedule && (isRequesting || !schedules)) {
            canPaginateForward = false;
            canPaginateBackward = false;
        }

        projectSchedule =
            projectSchedule && projectSchedule.schedules ? (
                <RenderIfUserInSubProject
                    subProjectId={currentProjectId}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '() => any' is not assignable to type 'Key | ... Remove this comment to see the full error message
                    key={() => uuidv4()}
                >
                    <div className="bs-BIM">
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <ScheduleProjectBox
                                    projectId={currentProjectId}
                                    currentProject={currentProject}
                                    schedules={schedules}
                                    isRequesting={isRequesting}
                                    count={count}
                                    skip={skip}
                                    limit={limit}
                                    numberOfSchedules={numberOfSchedules}
                                    subProjectSchedule={projectSchedule}
                                    subProjectName={
                                        subProjects &&
                                        subProjects.find(
                                            (obj: $TSFixMe) => obj._id === currentProjectId
                                        )?.name
                                    }
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduleModalId' does not exist on type ... Remove this comment to see the full error message
                                    scheduleModalId={this.state.scheduleModalId}
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                    openModal={this.props.openModal}
                                    subProject={
                                        subProjects &&
                                        subProjects.find(
                                            (obj: $TSFixMe) => obj._id === currentProjectId
                                        )
                                    }
                                    prevClicked={this.prevClicked}
                                    nextClicked={this.nextClicked}
                                    canPaginateBackward={canPaginateBackward}
                                    canPaginateForward={canPaginateForward}
                                    subProjects={subProjects}
                                    allScheduleLength={
                                        subProjectSchedules.length
                                    }
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalList' does not exist on type 'Reado... Remove this comment to see the full error message
                                    modalList={this.props.modalList}
                                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                    page={this.state[currentProjectId]}
                                />
                            </div>
                        </div>
                    </div>
                </RenderIfUserInSubProject>
            ) : (
                false
            );

        const allSchedules = projectSchedule && [projectSchedule];
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProjectId;
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem route={pathname} name="On-Call Duty" />
                <div
                    id="onCallSchedulePage"
                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                    tabIndex="0"
                    onKeyDown={this.handleKeyBoard}
                >
                    <div>
                        <div>
                            <ShouldRender
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                if={this.props.tutorialStat.callSchedule.show}
                            >
                                <TutorialBox
                                    type="call-schedule"
                                    currentProjectId={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                                        this.props.currentProjectId
                                    }
                                />
                            </ShouldRender>

                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                            {!this.props.isRequesting && allSchedules}
                        </div>
                    </div>
                </div>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                <ShouldRender if={this.props.isRequesting}>
                    <LoadingState />
                </ShouldRender>
            </Fade>
        );
    }
}

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        openModal,
        closeModal,
        fetchProjectSchedule,
        createSchedule,
        paginate,
        fetchSubProjectSchedules,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    let subProjects = state.subProject.subProjects.subProjects;
    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map((subProject: $TSFixMe) => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map((name: $TSFixMe) => subProjects.find((subProject: $TSFixMe) => subProject.name === name)
        );
    const projectId = state.subProject.activeSubProject;
    const currentProjectId = projectId;
    const schedules = state.schedule.subProjectSchedules;

    // find project schedules or assign default value
    let projectSchedule = schedules.find(
        (schedule: $TSFixMe) => schedule._id === currentProjectId
    );
    projectSchedule = projectSchedule
        ? projectSchedule
        : {
              _id: currentProjectId,
              schedules: [],
              count: 0,
              skip: 0,
              limit: 10,
          };

    // find subproject schedules or assign default value
    const subProjectSchedules =
        subProjects &&
        subProjects.map((subProject: $TSFixMe) => {
            const schedule = schedules.find(
                (schedule: $TSFixMe) => schedule._id === subProject._id
            );
            return schedule
                ? schedule
                : {
                      _id: subProject._id,
                      schedules: [],
                      count: 0,
                      skip: 0,
                      limit: 10,
                  };
        });

    subProjectSchedules && subProjectSchedules.unshift(projectSchedule);

    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat = {
        callSchedule: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }

    return {
        currentProjectId,
        subProjectSchedules,
        isRequesting: state.schedule.schedules.requesting,
        pages: state.schedule.pages,
        projectId,
        subProjects,
        currentProject: state.project.currentProject,
        tutorialStat,
        modalList: state.modal.modals,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
OnCall.propTypes = {
    subProjectSchedules: PropTypes.array.isRequired,
    subProjects: PropTypes.array.isRequired,
    fetchProjectSchedule: PropTypes.func.isRequired,
    fetchSubProjectSchedules: PropTypes.func.isRequired,
    history: PropTypes.object.isRequired,
    currentProjectId: PropTypes.string.isRequired,
    isRequesting: PropTypes.bool,
    paginate: PropTypes.func.isRequired,
    createSchedule: PropTypes.func.isRequired,
    pages: PropTypes.object.isRequired,
    openModal: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    tutorialStat: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    modalList: PropTypes.array,
    switchToProjectViewerNav: PropTypes.bool,
    projectId: PropTypes.string,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
OnCall.displayName = 'OnCall';

export default connect(mapStateToProps, mapDispatchToProps)(OnCall);
