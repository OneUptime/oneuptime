import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
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
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
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
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import Themes from '../components/status-page/Themes';
import StatusPageSubscriber from '../components/status-page/StatusPageSubscriber';
import Announcements from '../components/status-page/Announcements';
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
    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');

        setTimeout(() => {
            tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        });
        this.setState({
            tabIndex: index,
        });
    };

    async componentDidMount() {
        const projectId = this.props.projectId && this.props.projectId;
        const statusPageSlug = history.location.pathname
            .split('status-page/')[1]
            .split('/')[0];
        if (projectId) {
            await this.props.fetchProjectStatusPage(projectId);
            await this.props.fetchSubProjectStatusPages(projectId);
            this.props.fetchComponents({ projectId });
            this.props.fetchMonitors(projectId);
        }
        if (!this.props.statusPage.status._id) {
            if (
                this.props.statusPage.subProjectStatusPages &&
                this.props.statusPage.subProjectStatusPages.length > 0
            ) {
                const { subProjectStatusPages } = this.props.statusPage;
                subProjectStatusPages.forEach(subProject => {
                    const statusPages = subProject.statusPages;
                    const statusPage = statusPages.find(
                        page => page.slug === statusPageSlug
                    );
                    if (statusPage) {
                        this.props.switchStatusPage(statusPage);
                    }
                });
            }
        }
    }
    componentWillMount() {
        resetIdCounter();
    }

    async componentDidUpdate(prevProps) {
        if (
            prevProps.statusPage.status._id !== this.props.statusPage.status._id
        ) {
            this.tabSelected(0);

            if (this.props.statusPage.status.projectId) {
                const projectId =
                    this.props.statusPage.status.projectId._id ||
                    this.props.statusPage.status.projectId;
                const statusPageId = this.props.statusPage.status._id;
                this.props.fetchAllStatusPageCategories({
                    projectId,
                    statusPageId,
                    skip: 0,
                    limit: 0,
                });
            }
        }

        if (prevProps.projectId !== this.props.projectId) {
            if (!this.props.statusPage.status._id) {
                const projectId = this.props.projectId && this.props.projectId;
                const statusPageSlug = history.location.pathname
                    .split('status-page/')[1]
                    .split('/')[0];
                if (projectId) {
                    await this.props.fetchProjectStatusPage(projectId);
                    await this.props.fetchSubProjectStatusPages(projectId);
                    this.props.fetchComponents({ projectId: projectId });
                    this.props.fetchMonitors(projectId);
                }
                if (
                    this.props.statusPage.subProjectStatusPages &&
                    this.props.statusPage.subProjectStatusPages.length > 0
                ) {
                    const { subProjectStatusPages } = this.props.statusPage;
                    subProjectStatusPages.forEach(subProject => {
                        const statusPages = subProject.statusPages;
                        const statusPage = statusPages.find(
                            page => page.slug === statusPageSlug
                        );
                        if (statusPage) {
                            this.props.switchStatusPage(statusPage);
                        }
                    });
                }
            }
        }

        if (prevProps.activeProjectId !== this.props.activeProjectId) {
            // navigate back to the parent section
            this.props.history.push(
                `/dashboard/project/${this.props.currentProject.slug}/status-pages`
            );
        }
    }

    validateMonitors = monitors => {
        let monitorError;
        const selectedMonitor = {};
        for (let i = 0; i < monitors.length; i++) {
            const monitor = monitors[i];
            if (!monitor.monitor) monitorError = 'Please select a monitor.';
            else {
                if (selectedMonitor[monitor.monitor])
                    monitorError = 'Only unique monitors are allowed.';
                selectedMonitor[monitor.monitor] = true;
            }

            if (monitorError) break;
        }

        this.setState({ monitorError });
        return monitorError;
    };

    updateMonitor = () => {
        const { allStatusPageCategories, formState, statusPage } = this.props;
        const { status } = statusPage;
        const { projectId } = status;

        const monitors = [];
        const groupedMonitors = {};
        allStatusPageCategories.forEach(category => {
            const form = formState[category.name];
            const values = form?.values;
            if (values && values.monitors && values.monitors.length > 0) {
                monitors.push(...values.monitors);

                values.monitors.forEach(monitorObj => {
                    if (!groupedMonitors[monitorObj.statusPageCategory]) {
                        groupedMonitors[monitorObj.statusPageCategory] = [
                            monitorObj,
                        ];
                    } else {
                        groupedMonitors[monitorObj.statusPageCategory] = [
                            ...groupedMonitors[monitorObj.statusPageCategory],
                            monitorObj,
                        ];
                    }
                });
            }
        });

        if (!this.validateMonitors(monitors)) {
            this.props
                .updateStatusPageMonitors(projectId._id || projectId, {
                    _id: status._id,
                    monitors,
                    groupedMonitors,
                })
                .then(() => {
                    this.props.fetchProjectStatusPage(
                        this.props.currentProject._id,
                        true,
                        0,
                        10
                    );
                });
            if (SHOULD_LOG_ANALYTICS) {
                logEvent(
                    'EVENT: DASHBOARD > PROJECT > STATUS PAGES > STATUS PAGE > MONITOR UPDATED'
                );
            }
        }
    };

    render() {
        const {
            location: { pathname },
            statusPage: { status },
            currentProject,
            switchToProjectViewerNav,
            loadingCategories,
            allStatusPageCategories,
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
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
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
                    onSelect={tabIndex => this.tabSelected(tabIndex)}
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
                                                                .statusPage
                                                                .requesting
                                                        }
                                                    >
                                                        <TabPanel>
                                                            <Fade>
                                                                <div className="Box-root Margin-bottom--12">
                                                                    <Basic
                                                                        currentProject={
                                                                            this
                                                                                .props
                                                                                .currentProject
                                                                        }
                                                                    />
                                                                </div>
                                                                <RenderIfSubProjectAdmin
                                                                    subProjectId={
                                                                        this
                                                                            .props
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
                                                                                    category => (
                                                                                        <MonitorsWithCategory
                                                                                            subProjectId={
                                                                                                this
                                                                                                    .props
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
                                                                                                    .monitors
                                                                                            }
                                                                                            allStatusPageCategories={
                                                                                                allStatusPageCategories
                                                                                            }
                                                                                        />
                                                                                    )
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
                                                                    projectId={
                                                                        data.projectId
                                                                    }
                                                                    statusPage={
                                                                        status
                                                                    }
                                                                    currentProject={
                                                                        this
                                                                            .props
                                                                            .currentProject
                                                                    }
                                                                    subProjects={
                                                                        this
                                                                            .props
                                                                            .subProjects
                                                                    }
                                                                />
                                                            </div>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <div>
                                                                <Announcements
                                                                    projectId={
                                                                        data.projectId
                                                                    }
                                                                    statusPage={
                                                                        status
                                                                    }
                                                                    currentProject={
                                                                        this
                                                                            .props
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
                                                                            multipleLanguages={
                                                                                this
                                                                                    .props
                                                                                    .statusPage
                                                                                    ?.status
                                                                                    ?.multipleLanguages
                                                                            }
                                                                        />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <ExternalStatusPages
                                                                            statusPageId={
                                                                                this
                                                                                    .props
                                                                                    .statusPage
                                                                                    .status
                                                                                    ._id
                                                                            }
                                                                            subProjectId={
                                                                                this
                                                                                    .props
                                                                                    .subProjectId
                                                                            }
                                                                        />
                                                                    </div>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <DuplicateStatusBox
                                                                            statusPageId={
                                                                                this
                                                                                    .props
                                                                                    .statusPage
                                                                                    .status
                                                                                    ._id
                                                                            }
                                                                            subProjectId={
                                                                                this
                                                                                    .props
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
                                                                            .subProjectId
                                                                    }
                                                                >
                                                                    <DeleteBox
                                                                        match={
                                                                            this
                                                                                .props
                                                                                .match
                                                                        }
                                                                        subProjectId={
                                                                            this
                                                                                .props
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

const mapDispatchToProps = dispatch => {
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

function mapStateToProps(state, props) {
    const { statusPageSlug } = props.match.params;
    const statusPageObject = state.statusPage;
    let statusPage;
    if (
        statusPageObject.subProjectStatusPages &&
        statusPageObject.subProjectStatusPages.length > 0
    ) {
        const { subProjectStatusPages } = statusPageObject;
        subProjectStatusPages.forEach(subProject => {
            const statusPages = subProject.statusPages;
            if (!statusPage) {
                statusPage = statusPages.find(
                    page => page.slug === statusPageSlug
                );
            }
        });
    }
    const subProjectId = statusPage && statusPage.projectId._id;
    const monitors = state.monitor.monitorsList.monitors
        .filter(monitor => String(monitor._id) === String(subProjectId))
        .map(monitor => monitor.monitors)
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

StatusPage.displayName = 'StatusPage';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPage);
