import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import ShouldRender from '../components/basic/ShouldRender';
import Setting from '../components/status-page/Setting';
import Basic from '../components/status-page/Basic';
import Header from '../components/status-page/Header';
import Monitors from '../components/status-page/Monitors';
import Branding from '../components/status-page/Branding';
import StatusPageLayout from '../components/status-page/StatusPageLayout';
import Links from '../components/status-page/Links';
import DeleteBox from '../components/status-page/DeleteBox';
import DuplicateStatusBox from '../components/status-page/DuplicateStatusPage';
import ExternalStatusPages from '../components/status-page/ExternalStatusPages';
import PrivateStatusPage from '../components/status-page/PrivateStatusPage';
import StatusPageLanguage from '../components/status-page/StatusPageLanguage';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import { FormLoader, LoadingState } from '../components/basic/Loader';
import PropTypes from 'prop-types';

import { history } from '../store';

import {
    fetchSubProjectStatusPages,
    switchStatusPage,
    fetchProjectStatusPage,
    updateStatusPageMonitors,
} from '../actions/statusPage';
import CustomStyles from '../components/status-page/CustomStyles';
import EmbeddedBubble from '../components/status-page/EmbeddedBubble';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import Themes from '../components/status-page/Themes';
import StatusPageSubscriber from '../components/status-page/StatusPageSubscriber';
import Announcements from '../components/status-page/Announcements';
// @ts-expect-error ts-migrate(2613) FIXME: Module '"/home/nawazdhandala/Projects/OneUptime/ap... Remove this comment to see the full error message
import StatusPageCategory from '../components/status-page/StatusPageCategory';
import { fetchAllStatusPageCategories } from '../actions/statusPageCategory';
import MonitorsWithCategory from '../components/status-page/MonitorsWithCategory';
import EmptyCategory from '../components/status-page/EmptyCategory';
import { fetchComponents } from '../actions/component';
import { fetchMonitors } from '../actions/monitor';

class StatusPage extends Component {
    state = {
        tabIndex: 0,
        monitorError: null,
    };
    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');

        setTimeout(() => {
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        });
        this.setState({
            tabIndex: index,
        });
    };

    async componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const projectId = this.props.projectId && this.props.projectId;
        const statusPageSlug = history.location.pathname
            .split('status-page/')[1]
            .split('/')[0];
        if (projectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectStatusPage' does not exist o... Remove this comment to see the full error message
            await this.props.fetchProjectStatusPage(projectId);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSubProjectStatusPages' does not exi... Remove this comment to see the full error message
            await this.props.fetchSubProjectStatusPages(projectId);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponents' does not exist on type ... Remove this comment to see the full error message
            this.props.fetchComponents({ projectId });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitors' does not exist on type 'R... Remove this comment to see the full error message
            this.props.fetchMonitors(projectId);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        if (!this.props.statusPage.status._id) {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusPage.subProjectStatusPages &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusPage.subProjectStatusPages.length > 0
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                const { subProjectStatusPages } = this.props.statusPage;
                subProjectStatusPages.forEach((subProject: $TSFixMe) => {
                    const statusPages = subProject.statusPages;
                    const statusPage = statusPages.find(
                        (page: $TSFixMe) => page.slug === statusPageSlug
                    );
                    if (statusPage) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchStatusPage' does not exist on type... Remove this comment to see the full error message
                        this.props.switchStatusPage(statusPage);
                    }
                });
            }
        }
    }
    componentWillMount() {
        resetIdCounter();
    }

    async componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            prevProps.statusPage.status._id !== this.props.statusPage.status._id
        ) {
            this.tabSelected(0);

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            if (this.props.statusPage.status.projectId) {
                const projectId =
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                    this.props.statusPage.status.projectId._id ||
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                    this.props.statusPage.status.projectId;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                const statusPageId = this.props.statusPage.status._id;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAllStatusPageCategories' does not e... Remove this comment to see the full error message
                this.props.fetchAllStatusPageCategories({
                    projectId,
                    statusPageId,
                    skip: 0,
                    limit: 0,
                });
            }
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        if (prevProps.projectId !== this.props.projectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            if (!this.props.statusPage.status._id) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                const projectId = this.props.projectId && this.props.projectId;
                const statusPageSlug = history.location.pathname
                    .split('status-page/')[1]
                    .split('/')[0];
                if (projectId) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectStatusPage' does not exist o... Remove this comment to see the full error message
                    await this.props.fetchProjectStatusPage(projectId);
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSubProjectStatusPages' does not exi... Remove this comment to see the full error message
                    await this.props.fetchSubProjectStatusPages(projectId);
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponents' does not exist on type ... Remove this comment to see the full error message
                    this.props.fetchComponents({ projectId: projectId });
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitors' does not exist on type 'R... Remove this comment to see the full error message
                    this.props.fetchMonitors(projectId);
                }
                if (
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                    this.props.statusPage.subProjectStatusPages &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                    this.props.statusPage.subProjectStatusPages.length > 0
                ) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                    const { subProjectStatusPages } = this.props.statusPage;
                    subProjectStatusPages.forEach((subProject: $TSFixMe) => {
                        const statusPages = subProject.statusPages;
                        const statusPage = statusPages.find(
                            (page: $TSFixMe) => page.slug === statusPageSlug
                        );
                        if (statusPage) {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchStatusPage' does not exist on type... Remove this comment to see the full error message
                            this.props.switchStatusPage(statusPage);
                        }
                    });
                }
            }
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        if (prevProps.activeProjectId !== this.props.activeProjectId) {
            // navigate back to the parent section
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.history.push(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                `/dashboard/project/${this.props.currentProject.slug}/status-pages`
            );
        }
    }

    validateMonitors = (monitors: $TSFixMe) => {
        let monitorError;
        const selectedMonitor = {};
        for (let i = 0; i < monitors.length; i++) {
            const monitor = monitors[i];
            if (!monitor.monitor) monitorError = 'Please select a monitor.';
            else {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                if (selectedMonitor[monitor.monitor])
                    monitorError = 'Only unique monitors are allowed.';
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                selectedMonitor[monitor.monitor] = true;
            }

            if (monitorError) break;
        }

        this.setState({ monitorError });
        return monitorError;
    };

    updateMonitor = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'allStatusPageCategories' does not exist ... Remove this comment to see the full error message
        const { allStatusPageCategories, formState, statusPage } = this.props;
        const { status } = statusPage;
        const { projectId } = status;

        const monitors: $TSFixMe = [];
        const groupedMonitors = {};
        allStatusPageCategories.forEach((category: $TSFixMe) => {
            const form = formState[category.name];
            const values = form?.values;
            if (values && values.monitors && values.monitors.length > 0) {
                monitors.push(...values.monitors);

                values.monitors.forEach((monitorObj: $TSFixMe) => {
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    if (!groupedMonitors[monitorObj.statusPageCategory]) {
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        groupedMonitors[monitorObj.statusPageCategory] = [
                            monitorObj,
                        ];
                    } else {
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        groupedMonitors[monitorObj.statusPageCategory] = [
                            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                            ...groupedMonitors[monitorObj.statusPageCategory],
                            monitorObj,
                        ];
                    }
                });
            }
        });

        if (!this.validateMonitors(monitors)) {
            this.props
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateStatusPageMonitors' does not exist... Remove this comment to see the full error message
                .updateStatusPageMonitors(projectId._id || projectId, {
                    _id: status._id,
                    monitors,
                    groupedMonitors,
                })
                .then(() => {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectStatusPage' does not exist o... Remove this comment to see the full error message
                    this.props.fetchProjectStatusPage(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                        this.props.currentProject._id,
                        true,
                        0,
                        10
                    );
                });
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            statusPage: { status },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'loadingCategories' does not exist on typ... Remove this comment to see the full error message
            loadingCategories,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'allStatusPageCategories' does not exist ... Remove this comment to see the full error message
            allStatusPageCategories,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
            activeProjectId,
        } = this.props;
        const pageName = status ? status.name : null;
        const data = {
            statusPageId: status._id,
            projectId:
                status.projectId && (status.projectId._id || status.projectId),
            theme: status.theme,
        };
        const projectName = currentProject ? currentProject.name : '';
        const projectId = activeProjectId;
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
                <BreadCrumbItem
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
                    route={getParentRoute(pathname)}
                    name="Status Pages"
                />
                <BreadCrumbItem
                    route={pathname}
                    name={pageName}
                    pageTitle="Status Page"
                    status={pageName}
                />
                <div className="Box-root Margin-bottom--12">
                    <Header />
                </div>
                <Tabs
                    selectedTabClassName={'custom-tab-selected'}
                    onSelect={(tabIndex: $TSFixMe) => this.tabSelected(tabIndex)}
                    selectedIndex={this.state.tabIndex}
                >
                    <div className="Flex-flex Flex-direction--columnReverse">
                        <TabList
                            id="customTabList"
                            className={'custom-tab-list'}
                        >
                            <Tab
                                className={'custom-tab custom-tab-6 basic-tab'}
                            >
                                Basic
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 subscribers-tab'
                                }
                            >
                                Subscribers
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 announcements-tab'
                                }
                            >
                                Announcements
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 custom-domains-tab'
                                }
                            >
                                Custom Domains
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 branding-tab'
                                }
                            >
                                Branding
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 embedded-tab'
                                }
                            >
                                Embedded
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 advanced-options-tab'
                                }
                            >
                                Advanced Options
                            </Tab>
                            <div
                                id="tab-slider"
                                className="custom-tab-6 status-tab"
                            ></div>
                        </TabList>
                    </div>

                    <div className="Box-root">
                        <div>
                            <div>
                                <div className="db-BackboneViewContainer">
                                    <div className="react-settings-view react-view">
                                        <span data-reactroot="">
                                            <div>
                                                <div>
                                                    <ShouldRender
                                                        if={
                                                            !this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                .statusPage
                                                                .requesting
                                                        }
                                                    >
                                                        <TabPanel>
                                                            <Fade>
                                                                <div className="Box-root Margin-bottom--12">
                                                                    <Basic
                                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ currentProject: any; }' is not assignable ... Remove this comment to see the full error message
                                                                        currentProject={
                                                                            this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                                .currentProject
                                                                        }
                                                                    />
                                                                </div>
                                                                <RenderIfSubProjectAdmin
                                                                    subProjectId={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                                            .subProjectId
                                                                    }
                                                                >
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        {status &&
                                                                        status.isGroupedByMonitorCategory ? (
                                                                            !loadingCategories &&
                                                                            allStatusPageCategories &&
                                                                            allStatusPageCategories.length >
                                                                                0 ? (
                                                                                allStatusPageCategories.map(
                                                                                    (category: $TSFixMe) => <MonitorsWithCategory
                                                                                        subProjectId={
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                                                                .subProjectId
                                                                                        }
                                                                                        key={
                                                                                            category._id
                                                                                        }
                                                                                        status={
                                                                                            status
                                                                                        }
                                                                                        category={
                                                                                            category
                                                                                        }
                                                                                        monitors={
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                                .monitors
                                                                                        }
                                                                                        allStatusPageCategories={
                                                                                            allStatusPageCategories
                                                                                        }
                                                                                    />
                                                                                )
                                                                            ) : (
                                                                                <EmptyCategory
                                                                                    tabSelected={
                                                                                        this
                                                                                            .tabSelected
                                                                                    }
                                                                                />
                                                                            )
                                                                        ) : (
                                                                            <Monitors
                                                                                subProjectId={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                                                        .subProjectId
                                                                                }
                                                                            />
                                                                        )}
                                                                        {status &&
                                                                            status.isGroupedByMonitorCategory &&
                                                                            !loadingCategories &&
                                                                            allStatusPageCategories &&
                                                                            allStatusPageCategories.length >
                                                                                0 && (
                                                                                <div className="bs-ContentSection Card-root Card-shadow--medium bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                                                                    <span className="db-SettingsForm-footerMessage"></span>
                                                                                    <div
                                                                                        style={{
                                                                                            display:
                                                                                                'flex',
                                                                                            alignItems:
                                                                                                'center',
                                                                                            justifyContent:
                                                                                                'space-between',
                                                                                            width:
                                                                                                '100%',
                                                                                        }}
                                                                                    >
                                                                                        <div
                                                                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                                                            style={{
                                                                                                marginTop:
                                                                                                    '10px',
                                                                                            }}
                                                                                        >
                                                                                            <ShouldRender
                                                                                                if={
                                                                                                    this
                                                                                                        .props
                                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                                        .statusPage
                                                                                                        .monitors
                                                                                                        .error ||
                                                                                                    this
                                                                                                        .state
                                                                                                        .monitorError
                                                                                                }
                                                                                            >
                                                                                                <div className="Box-root Margin-right--8">
                                                                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                                                                </div>
                                                                                                <div className="Box-root">
                                                                                                    <span
                                                                                                        style={{
                                                                                                            color:
                                                                                                                'red',
                                                                                                        }}
                                                                                                    >
                                                                                                        {this
                                                                                                            .props
                                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                                            .statusPage
                                                                                                            .monitors
                                                                                                            .error ||
                                                                                                            this
                                                                                                                .state
                                                                                                                .monitorError}
                                                                                                    </span>
                                                                                                </div>
                                                                                            </ShouldRender>
                                                                                        </div>
                                                                                        <div
                                                                                            style={{
                                                                                                textAlign:
                                                                                                    'right',
                                                                                            }}
                                                                                        >
                                                                                            <button
                                                                                                id="btnAddStatusPageMonitors"
                                                                                                className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                                                                                disabled={
                                                                                                    this
                                                                                                        .props
                                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                                        .statusPage
                                                                                                        .monitors
                                                                                                        .requesting
                                                                                                }
                                                                                                type="button"
                                                                                                onClick={
                                                                                                    this
                                                                                                        .updateMonitor
                                                                                                }
                                                                                            >
                                                                                                {!this
                                                                                                    .props
                                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                                    .statusPage
                                                                                                    .monitors
                                                                                                    .requesting && (
                                                                                                    <span>
                                                                                                        Save
                                                                                                        Changes{' '}
                                                                                                    </span>
                                                                                                )}
                                                                                                {this
                                                                                                    .props
                                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                                    .statusPage
                                                                                                    .monitors
                                                                                                    .requesting && (
                                                                                                    <FormLoader />
                                                                                                )}
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                    </div>
                                                                </RenderIfSubProjectAdmin>
                                                            </Fade>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <div className="Box-root Margin-bottom--12 bs-ContentSection Card-root Card-shadow--medium>">
                                                                <StatusPageSubscriber
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; statusPage: any; currentPr... Remove this comment to see the full error message
                                                                    projectId={
                                                                        data.projectId
                                                                    }
                                                                    statusPage={
                                                                        status
                                                                    }
                                                                    currentProject={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                            .currentProject
                                                                    }
                                                                    subProjects={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                            .subProjects
                                                                    }
                                                                />
                                                            </div>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <div>
                                                                <Announcements
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; statusPage: any; currentPr... Remove this comment to see the full error message
                                                                    projectId={
                                                                        data.projectId
                                                                    }
                                                                    statusPage={
                                                                        status
                                                                    }
                                                                    currentProject={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                            .currentProject
                                                                    }
                                                                />
                                                            </div>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <div className="Box-root Margin-bottom--12">
                                                                    <Setting />
                                                                </div>
                                                            </Fade>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <RenderIfSubProjectAdmin
                                                                    subProjectId={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                                            .subProjectId
                                                                    }
                                                                >
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <Themes
                                                                            data={
                                                                                data
                                                                            }
                                                                        />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <Branding />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <Links />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <CustomStyles />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <StatusPageLayout />
                                                                    </div>
                                                                </RenderIfSubProjectAdmin>
                                                            </Fade>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <div className="Box-root Margin-bottom--12">
                                                                    <EmbeddedBubble />
                                                                </div>
                                                            </Fade>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <RenderIfSubProjectAdmin
                                                                    subProjectId={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                                            .subProjectId
                                                                    }
                                                                >
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <PrivateStatusPage />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <StatusPageCategory
                                                                            projectId={
                                                                                data.projectId
                                                                            }
                                                                            statusPageId={
                                                                                data.statusPageId
                                                                            }
                                                                        />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <StatusPageLanguage
                                                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ multipleLanguages: any; }' is not assignab... Remove this comment to see the full error message
                                                                            multipleLanguages={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                    .statusPage
                                                                                    ?.status
                                                                                    ?.multipleLanguages
                                                                            }
                                                                        />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <ExternalStatusPages
                                                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ statusPageId: any; subProjectId: any; }' i... Remove this comment to see the full error message
                                                                            statusPageId={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                    .statusPage
                                                                                    .status
                                                                                    ._id
                                                                            }
                                                                            subProjectId={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                                                    .subProjectId
                                                                            }
                                                                        />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <DuplicateStatusBox
                                                                            statusPageId={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                    .statusPage
                                                                                    .status
                                                                                    ._id
                                                                            }
                                                                            subProjectId={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                                                    .subProjectId
                                                                            }
                                                                            projectId={
                                                                                history.location.pathname
                                                                                    .split(
                                                                                        'project/'
                                                                                    )[1]
                                                                                    .split(
                                                                                        '/'
                                                                                    )[0]
                                                                            }
                                                                        />
                                                                    </div>
                                                                </RenderIfSubProjectAdmin>
                                                                <RenderIfSubProjectAdmin
                                                                    subProjectId={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                                            .subProjectId
                                                                    }
                                                                >
                                                                    <DeleteBox
                                                                        match={
                                                                            this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                                .match
                                                                        }
                                                                        subProjectId={
                                                                            this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                                                .subProjectId
                                                                        }
                                                                    />
                                                                </RenderIfSubProjectAdmin>
                                                            </Fade>
                                                        </TabPanel>
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                .statusPage
                                                                .requesting
                                                        }
                                                    >
                                                        <LoadingState />
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Tabs>
            </Fade>
        );
    }
}

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            fetchSubProjectStatusPages,
            switchStatusPage,
            fetchProjectStatusPage,
            fetchAllStatusPageCategories,
            updateStatusPageMonitors,
            fetchComponents,
            fetchMonitors,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe, props: $TSFixMe) {
    const { statusPageSlug } = props.match.params;
    const statusPageObject = state.statusPage;
    let statusPage: $TSFixMe;
    if (
        statusPageObject.subProjectStatusPages &&
        statusPageObject.subProjectStatusPages.length > 0
    ) {
        const { subProjectStatusPages } = statusPageObject;
        subProjectStatusPages.forEach((subProject: $TSFixMe) => {
            const statusPages = subProject.statusPages;
            if (!statusPage) {
                statusPage = statusPages.find(
                    (page: $TSFixMe) => page.slug === statusPageSlug
                );
            }
        });
    }
    const subProjectId = statusPage && statusPage.projectId._id;
    const monitors = state.monitor.monitorsList.monitors
        .filter((monitor: $TSFixMe) => String(monitor._id) === String(subProjectId))
        .map((monitor: $TSFixMe) => monitor.monitors)
        .flat();
    return {
        statusPage: statusPageObject,
        projectId: state.subProject?.activeSubProject,
        subProjectId,
        subProjects: state.subProject.subProjects.subProjects,
        currentProject:
            state.project.currentProject && state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        loadingCategories:
            state.statusPageCategory.fetchAllStatusPageCategories.requesting,
        allStatusPageCategories:
            state.statusPageCategory.fetchAllStatusPageCategories.categories,
        monitors,
        formState: state.form,
        activeProjectId: state.subProject?.activeSubProject,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
StatusPage.propTypes = {
    statusPage: PropTypes.object.isRequired,
    switchStatusPage: PropTypes.func,
    fetchProjectStatusPage: PropTypes.func,
    fetchSubProjectStatusPages: PropTypes.func,
    match: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    history: PropTypes.object,
    projectId: PropTypes.string,
    subProjectId: PropTypes.string,
    currentProject: PropTypes.object,
    subProjects: PropTypes.array,
    switchToProjectViewerNav: PropTypes.bool,
    fetchAllStatusPageCategories: PropTypes.func,
    loadingCategories: PropTypes.bool,
    allStatusPageCategories: PropTypes.array,
    monitors: PropTypes.array,
    updateStatusPageMonitors: PropTypes.func,
    formState: PropTypes.object,
    activeProjectId: PropTypes.string,
    fetchComponents: PropTypes.func,
    fetchMonitors: PropTypes.func,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
StatusPage.displayName = 'StatusPage';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPage);
