import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { destroy } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import ComponentSummary from '../components/component/ComponentSummary';
import NewMonitor from '../components/monitor/NewMonitor';
import MonitorList from '../components/monitor/MonitorList';
import ShouldRender from '../components/basic/ShouldRender';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import RenderIfSubProjectMember from '../components/basic/RenderIfSubProjectMember';
import { LoadingState } from '../components/basic/Loader';
import TutorialBox from '../components/tutorial/TutorialBox';
import PropTypes from 'prop-types';
import {
    fetchMonitorLogs,
    fetchMonitorsIncidents,
    fetchMonitorStatuses,
    fetchLighthouseLogs,
    fetchMonitors,
    fetchPaginatedMonitors,
} from '../actions/monitor';
import { fetchComponentSummary, fetchComponent } from '../actions/component';
import { loadPage } from '../actions/page';
import { fetchTutorial } from '../actions/tutorial';
import { getProbes } from '../actions/probe';
import IsUserInSubProject from '../components/basic/IsUserInSubProject';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import {
    fetchIncidentTemplates,
    fetchDefaultTemplate,
} from '../actions/incidentBasicsSettings';
import CustomTutorial from '../components/tutorial/CustomTutorial';
// import { socket } from '../components/basic/Socket';

class MonitorDashboardView extends Component {
    state = {
        showNewMonitorForm: false,
        page: 1,
    };

    prevClicked = (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPaginatedMonitors' does not exist o... Remove this comment to see the full error message
            .fetchPaginatedMonitors({
                projectId,
                skip: (skip || 0) > (limit || 5) ? skip - limit : 0,
                limit,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                componentSlug: this.props.componentSlug,
                paginate: true,
            })
            .then(() => {
                this.setState(prevState => {
                    return {
                        page:
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            prevState.page === 1
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                ? prevState.page
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                : prevState.page - 1,
                    };
                });
            });
    };

    nextClicked = (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPaginatedMonitors' does not exist o... Remove this comment to see the full error message
            .fetchPaginatedMonitors({
                projectId,
                skip: skip + limit,
                limit,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                componentSlug: this.props.componentSlug,
                paginate: true,
            })
            .then(() => {
                this.setState(prevState => {
                    return {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        page: prevState.page + 1,
                    };
                });
            });
    };

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'loadPage' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.loadPage('Monitors');

        this.ready();
    }

    fetchMonitorResources = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
        this.props.monitor.paginatedMonitorsList.monitors.forEach(
            (subProject: $TSFixMe) => {
                if (subProject.monitors.length > 0) {
                    subProject.monitors.forEach((monitor: $TSFixMe) => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorLogs' does not exist on type... Remove this comment to see the full error message
                        this.props.fetchMonitorLogs(
                            monitor.projectId._id || monitor.projectId,
                            monitor._id,
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
                            this.props.startDate,
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
                            this.props.endDate
                        );
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsIncidents' does not exist o... Remove this comment to see the full error message
                        this.props.fetchMonitorsIncidents(
                            monitor.projectId._id || monitor.projectId,
                            monitor._id,
                            0,
                            3
                        );
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorStatuses' does not exist on ... Remove this comment to see the full error message
                        this.props.fetchMonitorStatuses(
                            monitor.projectId._id || monitor.projectId,
                            monitor._id,
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
                            this.props.startDate,
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
                            this.props.endDate
                        );
                        if (
                            monitor.type === 'url' &&
                            monitor.data &&
                            monitor.data.url
                        ) {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLighthouseLogs' does not exist on t... Remove this comment to see the full error message
                            this.props.fetchLighthouseLogs(
                                monitor.projectId._id || monitor.projectId,
                                monitor._id,
                                0,
                                1,
                                monitor.data.url
                            );
                        }
                    });
                }
            }
        );
    };

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            JSON.stringify(prevProps.monitor.paginatedMonitorsList.monitors) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            JSON.stringify(this.props.monitor.paginatedMonitorsList.monitors)
        ) {
            this.fetchMonitorResources();
        }
        if (
            String(prevProps.componentSlug) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            String(this.props.componentSlug) ||
            JSON.stringify(prevProps.currentProject) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            JSON.stringify(this.props.currentProject)
        ) {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                this.props.componentSlug
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                this.props.fetchComponent(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                    this.props.componentSlug
                );
            }
        }

        if (
            JSON.stringify(prevProps.currentProject) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            JSON.stringify(this.props.currentProject)
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchDefaultTemplate' does not exist on ... Remove this comment to see the full error message
            this.props.fetchDefaultTemplate({
                projectId:
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id || this.props.currentProject,
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentTemplates' does not exist o... Remove this comment to see the full error message
            this.props.fetchIncidentTemplates({
                projectId:
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id || this.props.currentProject,
                skip: 0,
                limit: 0,
            });
        }
    }

    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'destroy' does not exist on type 'Readonl... Remove this comment to see the full error message
        this.props.destroy('NewMonitor');
        // socket.removeListener(`createMonitor-${this.props.currentProject._id}`);
    }

    toggleForm = () =>
        this.setState(prevState => ({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showNewMonitorForm' does not exist on ty... Remove this comment to see the full error message
            showNewMonitorForm: !prevState.showNewMonitorForm,
        }));

    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const projectId = this.props.currentProject
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject._id
            : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
        if (projectId && this.props.componentSlug) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            this.props.fetchComponent(projectId, this.props.componentSlug);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getProbes(projectId, 0, 10); //0 -> skip, 10-> limit.
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (this.props.currentProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentPriorities' does not exist ... Remove this comment to see the full error message
            this.props.fetchIncidentPriorities(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id || this.props.currentProject,
                0,
                0
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentTemplates' does not exist o... Remove this comment to see the full error message
            this.props.fetchIncidentTemplates({
                projectId:
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id || this.props.currentProject,
                skip: 0,
                limit: 0,
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchDefaultTemplate' does not exist on ... Remove this comment to see the full error message
            this.props.fetchDefaultTemplate({
                projectId:
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id || this.props.currentProject,
            });
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPaginatedMonitors' does not exist o... Remove this comment to see the full error message
        this.props.fetchPaginatedMonitors({
            projectId,
            skip: 0,
            limit: 5,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug: this.props.componentSlug,
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            subProjects,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponentSummary' does not exist on... Remove this comment to see the full error message
            fetchComponentSummary,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSummaryObj' does not exist on t... Remove this comment to see the full error message
            componentSummaryObj,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (this.props.currentProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            document.title = this.props.currentProject.name + ' Dashboard';
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
        if (this.props.monitors.length) {
            const scriptElement = document.createElement('script');
            scriptElement.type = 'text/javascript';
            scriptElement.src = '/dashboard/assets/js/landing.base.js';
            document.head.appendChild(scriptElement);
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
        const monitor = this.props.monitor;
        if (component && component._id) {
            monitor.paginatedMonitorsList.monitors.forEach((item: $TSFixMe) => {
                item.monitors = item.monitors.filter(
                    (monitor: $TSFixMe) => monitor.componentId._id === component._id
                );
            });
        }

        let allMonitors = monitor.paginatedMonitorsList.monitors
            .map((monitor: $TSFixMe) => monitor.monitors)
            .flat();

        const currentProjectId = currentProject ? currentProject._id : null;
        const currentProjectSlug = currentProject ? currentProject.slug : null;

        // SubProject Monitors List
        let monitors =
            subProjects &&
            subProjects.map((subProject: $TSFixMe, i: $TSFixMe) => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                const subProjectMonitor = this.props.monitor.paginatedMonitorsList.monitors.find(
                    (subProjectMonitor: $TSFixMe) => subProjectMonitor._id === subProject._id
                );
                allMonitors = IsUserInSubProject(subProject)
                    ? allMonitors
                    : allMonitors.filter(
                        (monitor: $TSFixMe) => monitor.projectId !== subProjectMonitor._id ||
                            monitor.projectId._id !== subProjectMonitor._id
                    );
                return subProjectMonitor &&
                    subProjectMonitor.monitors.length > 0 ? (
                    <div
                        id={`box_${subProject.name}`}
                        className="Box-root Margin-vertical--12"
                        key={i}
                    >
                        <div
                            className="db-Trends Card-root"
                            style={{ overflow: 'visible' }}
                        >
                            <MonitorList
                                componentId={componentId}
                                shouldRenderProjectType={
                                    subProjects && subProjects.length > 0
                                }
                                projectType={'subproject'}
                                projectName={subProject.name}
                                monitors={subProjectMonitor.monitors}
                                projectId={subProject._id}
                                skip={subProjectMonitor.skip}
                                limit={subProjectMonitor.limit}
                                count={subProjectMonitor.count}
                                requesting={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                    this.props.monitor.paginatedMonitorsList
                                        .requesting
                                }
                                error={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                    this.props.monitor.paginatedMonitorsList
                                        .error
                                }
                                page={this.state.page}
                                prevClicked={this.prevClicked}
                                nextClicked={this.nextClicked}
                                requestingNextPage={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                    this.props.monitor.paginatedMonitorsList
                                        .requestingNextPage
                                }
                            />
                        </div>
                    </div>
                ) : (
                    false
                );
            });

        // Add Project Monitors to Monitors List
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
        let projectMonitor = this.props.monitor.paginatedMonitorsList.monitors.find(
            (subProjectMonitor: $TSFixMe) => subProjectMonitor._id === currentProjectId
        );
        allMonitors = IsUserInSubProject(currentProject)
            ? allMonitors
            : allMonitors.filter(
                (monitor: $TSFixMe) => monitor.projectId !== currentProject._id ||
                    monitor.projectId._id !== currentProject._id
            );
        projectMonitor =
            projectMonitor && projectMonitor.monitors.length > 0 ? (
                <div
                    id={`box_${currentProject.name}`}
                    key={`box_${currentProject.name}`}
                    className="Box-root Margin-vertical--12"
                >
                    <div
                        className="db-Trends Card-root"
                        style={{ overflow: 'visible' }}
                    >
                        <MonitorList
                            componentId={componentId}
                            shouldRenderProjectType={
                                subProjects && subProjects.length > 0
                            }
                            projectType={'project'}
                            projectName={'Project'}
                            monitors={projectMonitor.monitors}
                            projectId={currentProject._id}
                            skip={projectMonitor.skip}
                            limit={projectMonitor.limit}
                            count={projectMonitor.count}
                            requesting={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                this.props.monitor.paginatedMonitorsList
                                    .requesting
                            }
                            error={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                this.props.monitor.paginatedMonitorsList.error
                            }
                            page={this.state.page}
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}
                            requestingNextPage={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                this.props.monitor.paginatedMonitorsList
                                    .requestingNextPage
                            }
                        />
                    </div>
                </div>
            ) : (
                false
            );

        monitors && projectMonitor && monitors.unshift(projectMonitor);
        monitors = monitors.filter(
            (monitor: $TSFixMe) => monitor && typeof monitor === 'object'
        );
        const componentName = component ? component.name : '';
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
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
                <BreadCrumbItem route={pathname} name={componentName} />
                <BreadCrumbItem
                    route={pathname + '#'}
                    name={
                        this.state.showNewMonitorForm ||
                            !monitors ||
                            monitors.length === 0 ||
                            monitors[0] === false
                            ? 'New Monitor Form'
                            : 'Monitors'
                    }
                    pageTitle="Monitors"
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: string; pageTitle: st... Remove this comment to see the full error message
                    addBtn={monitors.length > 0 && monitors[0] !== false}
                    btnText="Create New Monitor"
                    toggleForm={this.toggleForm}
                />
                <div className="Box-root">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="dashboard-home-view react-view">
                                    <div>
                                        <div>
                                            <span>
                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        !this.props.monitor
                                                            .paginatedMonitorsList
                                                            .requesting
                                                    }
                                                >
                                                    {/* Here, component notifier */}
                                                    <CustomTutorial
                                                        monitors={allMonitors}
                                                        slug={
                                                            currentProjectSlug
                                                        }
                                                        tutorialStat={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                                                .tutorialStat
                                                        }
                                                        currentProjectId={
                                                            currentProjectId
                                                        }
                                                        hideActionButton={true}
                                                    />
                                                    <ShouldRender
                                                        if={
                                                            (!this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                                                .tutorialStat
                                                                .monitorCustom
                                                                .show ||
                                                                allMonitors.length >
                                                                0) &&
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                                                .tutorialStat
                                                                .monitor.show
                                                        }
                                                    >
                                                        <TutorialBox
                                                            type="monitor"
                                                            currentProjectId={
                                                                currentProjectId
                                                            }
                                                        />
                                                    </ShouldRender>

                                                    <ShouldRender
                                                        if={
                                                            !this.state
                                                                .showNewMonitorForm &&
                                                            monitors &&
                                                            monitors.length >
                                                            0 &&
                                                            monitors[0] !==
                                                            false
                                                        }
                                                    >
                                                        <ComponentSummary
                                                            projectId={
                                                                currentProjectId
                                                            }
                                                            componentId={
                                                                componentId
                                                            }
                                                            fetchSummary={
                                                                fetchComponentSummary
                                                            }
                                                            summary={
                                                                componentSummaryObj.data
                                                            }
                                                            loading={
                                                                componentSummaryObj.requesting
                                                            }
                                                        />
                                                    </ShouldRender>

                                                    {!this.state
                                                        .showNewMonitorForm &&
                                                        monitors &&
                                                        monitors.length > 0 &&
                                                        monitors}

                                                    <RenderIfSubProjectAdmin>
                                                        <ShouldRender
                                                            if={
                                                                this.state
                                                                    .showNewMonitorForm ||
                                                                !monitors ||
                                                                monitors.length ===
                                                                0 ||
                                                                monitors[0] ===
                                                                false
                                                            }
                                                        >
                                                            <NewMonitor
                                                                index={1000}
                                                                formKey="NewMonitorForm"
                                                                componentId={
                                                                    this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                        .componentId
                                                                }
                                                                componentSlug={
                                                                    this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                        .component &&
                                                                    this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                        .component
                                                                        .slug
                                                                }
                                                                showCancelBtn={
                                                                    monitors.length >
                                                                    0 &&
                                                                    monitors[0] !==
                                                                    false
                                                                }
                                                                toggleForm={
                                                                    this
                                                                        .toggleForm
                                                                }
                                                            />
                                                        </ShouldRender>
                                                    </RenderIfSubProjectAdmin>
                                                    <RenderIfSubProjectMember>
                                                        <ShouldRender
                                                            if={
                                                                !this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                    .monitor
                                                                    .paginatedMonitorsList
                                                                    .requesting &&
                                                                allMonitors.length ===
                                                                0
                                                            }
                                                        >
                                                            <div
                                                                id="app-loading"
                                                                style={{
                                                                    position:
                                                                        'fixed',
                                                                    top: '0',
                                                                    bottom: '0',
                                                                    left: '0',
                                                                    right: '0',
                                                                    backgroundColor:
                                                                        '#fdfdfd',
                                                                    zIndex:
                                                                        '999',
                                                                    display:
                                                                        'flex',
                                                                    justifyContent:
                                                                        'center',
                                                                    alignItems:
                                                                        'center',
                                                                    flexDirection:
                                                                        'column',
                                                                }}
                                                            >
                                                                <div
                                                                    className="db-SideNav-icon db-SideNav-icon--atlas "
                                                                    style={{
                                                                        backgroundRepeat:
                                                                            'no-repeat',
                                                                        backgroundSize:
                                                                            '50px',
                                                                        height:
                                                                            '50px',
                                                                        width:
                                                                            '50px',
                                                                    }}
                                                                ></div>
                                                                <div
                                                                    style={{
                                                                        marginTop:
                                                                            '20px',
                                                                        fontSize:
                                                                            '16px',
                                                                    }}
                                                                >
                                                                    No monitors
                                                                    are added to
                                                                    this
                                                                    project.
                                                                    Please
                                                                    contact your
                                                                    project
                                                                    admin.
                                                                </div>
                                                            </div>
                                                        </ShouldRender>
                                                    </RenderIfSubProjectMember>
                                                </ShouldRender>

                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        this.props.monitor
                                                            .paginatedMonitorsList
                                                            .requesting
                                                    }
                                                >
                                                    <LoadingState />
                                                </ShouldRender>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            destroy,
            fetchMonitorLogs,
            fetchMonitorsIncidents,
            fetchMonitorStatuses,
            fetchLighthouseLogs,
            fetchIncidentPriorities,
            fetchIncidentTemplates,
            loadPage,
            fetchTutorial,
            getProbes,
            fetchComponentSummary,
            fetchComponent,
            fetchMonitors,
            fetchDefaultTemplate,
            fetchPaginatedMonitors,
        },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { componentSlug } = ownProps.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const monitor = state.monitor;
    const component =
        state.component && state.component.currentComponent.component;

    let subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map((subProject: $TSFixMe) => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map((name: $TSFixMe) => subProjects.find((subProject: $TSFixMe) => subProject.name === name)
        );
    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat = {
        monitorCustom: { show: true },
        monitor: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }

    return {
        monitor,
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        currentProject: state.project.currentProject,
        incidents: state.incident.unresolvedincidents.incidents,
        monitors: state.monitor.paginatedMonitorsList.monitors,
        subProjects,
        startDate: state.monitor.paginatedMonitorsList.startDate,
        endDate: state.monitor.paginatedMonitorsList.endDate,
        component,
        tutorialStat,
        componentSummaryObj: state.component.componentSummary,
        componentSlug,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
MonitorDashboardView.propTypes = {
    currentProject: PropTypes.object,
    componentId: PropTypes.string,
    monitor: PropTypes.object,
    monitors: PropTypes.array,
    loadPage: PropTypes.func,
    destroy: PropTypes.func.isRequired,
    fetchMonitorLogs: PropTypes.func,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    fetchMonitorStatuses: PropTypes.func.isRequired,
    fetchLighthouseLogs: PropTypes.func.isRequired,
    subProjects: PropTypes.array,
    getProbes: PropTypes.func,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    fetchIncidentPriorities: PropTypes.func.isRequired,
    fetchIncidentTemplates: PropTypes.func.isRequired,
    tutorialStat: PropTypes.object,
    fetchComponentSummary: PropTypes.func,
    componentSummaryObj: PropTypes.object,
    fetchComponent: PropTypes.func,
    componentSlug: PropTypes.string,
    fetchDefaultTemplate: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
    fetchPaginatedMonitors: PropTypes.func,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MonitorDashboardView.displayName = 'MonitorDashboardView';

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorDashboardView);
