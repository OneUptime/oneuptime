import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import ShouldRender from '../components/basic/ShouldRender';
import Setting from '../components/statusPage/Setting';
import Basic from '../components/statusPage/Basic';
import Header from '../components/statusPage/Header';
import Monitors from '../components/statusPage/Monitors';
import Branding from '../components/statusPage/Branding';
import Links from '../components/statusPage/Links';
import DeleteBox from '../components/statusPage/DeleteBox';
import DuplicateStatusBox from '../components/statusPage/DuplicateStatusPage';
import PrivateStatusPage from '../components/statusPage/PrivateStatusPage';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import { LoadingState } from '../components/basic/Loader';
import PropTypes from 'prop-types';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { history } from '../store';
import {
    fetchSubProjectStatusPages,
    switchStatusPage,
    fetchProjectStatusPage,
} from '../actions/statusPage';
import { fetchSubProject } from '../actions/subProject';
import CustomStyles from '../components/statusPage/CustomStyles';
import EmbeddedBubble from '../components/statusPage/EmbeddedBubble';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import Themes from '../components/statusPage/Themes';
import StatusPageSubscriber from '../components/statusPage/StatusPageSubscriber';

class StatusPage extends Component {
    state = {
        tabIndex: 0,
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
        if (!this.props.statusPage.status._id) {
            const projectId = this.props.projectId && this.props.projectId;
            const statusPageSlug = history.location.pathname
                .split('status-page/')[1]
                .split('/')[0];
            if (projectId) {
                await this.props.fetchProjectStatusPage(projectId);
                await this.props.fetchSubProjectStatusPages(projectId);
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
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > STATUS PAGE LIST > STATUS PAGE'
            );
        }
        this.props.fetchSubProject(this.props.subProjectSlug);
    }
    componentWillMount() {
        resetIdCounter();
    }

    async componentDidUpdate(prevProps) {
        if (
            prevProps.statusPage.status._id !== this.props.statusPage.status._id
        ) {
            this.tabSelected(0);
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
    }

    render() {
        const {
            location: { pathname },
            statusPage: { status },
        } = this.props;
        const pageName = status ? status.name : null;
        const projectId = this.props.projectId;
        const data = {
            statusPageId: status._id,
            projectId:
                status.projectId && (status.projectId._id || status.projectId),
            theme: status.theme,
        };

        return (
            <Dashboard>
                <Fade>
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
                                <Tab className={'custom-tab custom-tab-6'}>
                                    Basic
                                </Tab>
                                <Tab className={'custom-tab custom-tab-6'}>
                                    Subscribers
                                </Tab>
                                <Tab className={'custom-tab custom-tab-6'}>
                                    Custom Domains
                                </Tab>
                                <Tab className={'custom-tab custom-tab-6'}>
                                    Branding
                                </Tab>
                                <Tab className={'custom-tab custom-tab-6'}>
                                    Embedded
                                </Tab>
                                <Tab className={'custom-tab custom-tab-6'}>
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
                                                                        <Basic />
                                                                    </div>
                                                                    <RenderIfSubProjectAdmin
                                                                        subProjectId={
                                                                            this
                                                                                .props
                                                                                .subProjectId
                                                                        }
                                                                    >
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <Monitors
                                                                                subProjectId={
                                                                                    this
                                                                                        .props
                                                                                        .subProjectId
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </RenderIfSubProjectAdmin>
                                                                </Fade>
                                                            </TabPanel>
                                                            <TabPanel>
                                                                <div className="Box-root Margin-bottom--12 bs-ContentSection Card-root Card-shadow--medium>">
                                                                    <StatusPageSubscriber
                                                                        projectId={
                                                                            projectId
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
                                                                            {this
                                                                                .props
                                                                                .showDuplicateStatusPage ? (
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
                                                                                    subProjectSlug={
                                                                                        this
                                                                                            .props
                                                                                            .subProjectSlug
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
                                                                            ) : null}
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
            </Dashboard>
        );
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchSubProjectStatusPages,
            switchStatusPage,
            fetchProjectStatusPage,
            fetchSubProject,
        },
        dispatch
    );
};

function mapStateToProps(state, props) {
    const { subProjectSlug } = props.match.params;
    return {
        statusPage: state.statusPage,
        subProjectSlug,
        showDuplicateStatusPage: state.statusPage.showDuplicateStatusPage,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        subProjectId:
            state.subProject.currentSubProject.subProject &&
            state.subProject.currentSubProject.subProject._id,
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
    };
}

StatusPage.propTypes = {
    statusPage: PropTypes.object.isRequired,
    switchStatusPage: PropTypes.func,
    fetchProjectStatusPage: PropTypes.func,
    fetchSubProjectStatusPages: PropTypes.func,
    fetchSubProject: PropTypes.func,
    showDuplicateStatusPage: PropTypes.bool,
    match: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    projectId: PropTypes.string,
    subProjectSlug: PropTypes.string,
    subProjectId: PropTypes.string,
    currentProject: PropTypes.object,
    subProjects: PropTypes.array,
};

StatusPage.displayName = 'StatusPage';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPage);
