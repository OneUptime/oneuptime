import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Fade from 'react-reveal/Fade';
import ApplicationSecurityForm from '../components/security/ApplicationSecurityForm';
import ApplicationSecurity from '../components/security/ApplicationSecurity';

import {
    getApplicationSecurities,
    getApplicationSecurityLogs,
    scanApplicationSecuritySuccess,
    getApplicationSecuritySuccess,
} from '../actions/security';
import { LargeSpinner, ListLoader } from '../components/basic/Loader';
import { fetchComponent } from '../actions/component';
import ShouldRender from '../components/basic/ShouldRender';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import sortByName from '../utils/sortByName';
import { history } from '../store';
import { socket } from '../components/basic/Socket';

class Application extends Component {
    state = {
        showApplicationSecurityForm: false,
        page: 1,
    };

    prevClicked = (projectId, componentId, skip, limit) => {
        this.props
            .getApplicationSecurities({
                projectId,
                componentId,
                skip: (skip || 0) > (limit || 5) ? skip - limit : 0,
                limit,
                fetchingPage: true,
            })
            .then(() => {
                this.setState(prevState => {
                    return {
                        page:
                            prevState.page === 1
                                ? prevState.page
                                : prevState.page - 1,
                    };
                });
            });
    };

    nextClicked = (projectId, componentId, skip, limit) => {
        this.props
            .getApplicationSecurities({
                projectId,
                componentId,
                skip: skip + limit,
                limit,
                fetchingPage: true,
            })
            .then(() => {
                this.setState(prevState => {
                    return {
                        page: prevState.page + 1,
                    };
                });
            });
    };

    componentDidMount() {
        const {
            projectId,
            componentId,
            getApplicationSecurities,
            getApplicationSecurityLogs,
            componentSlug,
            fetchComponent,
        } = this.props;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
        }
        if (projectId && componentId) {
            // load container security logs
            getApplicationSecurityLogs({ projectId, componentId });

            // load container security
            getApplicationSecurities({
                projectId,
                componentId,
                skip: 0,
                limit: 5,
            });
        }
    }

    componentDidUpdate(prevProps) {
        if (
            prevProps.projectId !== this.props.projectId ||
            prevProps.componentId !== this.props.componentId ||
            prevProps.componentSlug !== this.props.componentSlug
        ) {
            const {
                projectId,
                componentId,
                componentSlug,
                fetchComponent,
                getApplicationSecurities,
                getApplicationSecurityLogs,
            } = this.props;
            if (projectId && componentSlug) {
                fetchComponent(projectId, componentSlug);
            }
            if (projectId && componentId) {
                // load container security logs
                getApplicationSecurityLogs({ projectId, componentId });

                // load container security
                getApplicationSecurities({
                    projectId,
                    componentId,
                    skip: 0,
                    limit: 5,
                });
            }
        }
    }

    componentWillUnmount() {
        socket.removeListener(
            `createApplicationSecurity-${this.props.componentId}`
        );
    }

    toggleForm = () =>
        this.setState(prevState => ({
            showApplicationSecurityForm: !prevState.showApplicationSecurityForm,
        }));

    render() {
        const {
            projectId,
            componentId,
            applicationSecurities: appSecurities,
            gettingApplicationSecurities,
            gettingSecurityLogs,
            location: { pathname },
            component,
            componentSlug,
            // scanApplicationSecuritySuccess,
            // getApplicationSecuritySuccess,
            currentProject,
            switchToProjectViewerNav,
            skip,
            limit,
            count,
            fetchingPage,
            numberOfPage,
            error,
        } = this.props;

        const page = this.state.page;
        const canNext =
            appSecurities && count && count > skip + limit ? true : false;
        const canPrev = appSecurities && skip <= 0 ? false : true;
        const numberOfPages = numberOfPage
            ? numberOfPage
            : Math.ceil(parseInt(count) / limit);

        socket.emit('component_switch', componentId);

        socket.on(`createApplicationSecurity-${componentId}`, data => {
            history.push(
                `/dashboard/project/${this.props.slug}/component/${componentSlug}/security/application/${data.slug}`
            );
        });
        const applicationSecurities = appSecurities
            ? sortByName(appSecurities)
            : [];

        // applicationSecurities.length > 0 &&
        //     applicationSecurities.forEach(applicationSecurity => {
        //         // join room
        //         socket.emit('security_switch', applicationSecurity._id);

        //         socket.on(`security_${applicationSecurity._id}`, data => {
        //             getApplicationSecuritySuccess(data);
        //         });

        //         socket.on(`securityLog_${applicationSecurity._id}`, data => {
        //             scanApplicationSecuritySuccess(data);
        //         });
        //     });

        const componentName = component ? component.name : '';
        const projectName = currentProject ? currentProject.name : '';

        const isEmpty = applicationSecurities.length === 0;
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId || ''}
                    slug={currentProject ? currentProject.slug : null}
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'component')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={pathname}
                    name={
                        this.state.showApplicationSecurityForm || isEmpty
                            ? 'New Application Security'
                            : 'Application Security'
                    }
                    pageTitle="Application"
                    addBtn={!isEmpty}
                    btnText="Create Application Security"
                    toggleForm={this.toggleForm}
                />
                <div className="Margin-vertical--12">
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <ShouldRender
                                    if={
                                        gettingApplicationSecurities &&
                                        gettingSecurityLogs
                                    }
                                >
                                    <div style={{ textAlign: 'center' }}>
                                        <LargeSpinner />
                                    </div>
                                </ShouldRender>
                                <ShouldRender
                                    if={
                                        !gettingApplicationSecurities &&
                                        !gettingSecurityLogs
                                    }
                                >
                                    {!this.state.showApplicationSecurityForm &&
                                        !isEmpty &&
                                        applicationSecurities.map(
                                            applicationSecurity => {
                                                return (
                                                    <span
                                                        key={
                                                            applicationSecurity._id
                                                        }
                                                    >
                                                        <div>
                                                            <div>
                                                                <ApplicationSecurity
                                                                    name={
                                                                        applicationSecurity.name
                                                                    }
                                                                    applicationSecurityId={
                                                                        applicationSecurity._id
                                                                    }
                                                                    applicationSecuritySlug={
                                                                        applicationSecurity.slug
                                                                    }
                                                                    projectId={
                                                                        projectId
                                                                    }
                                                                    componentId={
                                                                        componentId
                                                                    }
                                                                    componentSlug={
                                                                        componentSlug
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </span>
                                                );
                                            }
                                        )}
                                </ShouldRender>
                                <span>
                                    <div>
                                        <div>
                                            <ShouldRender
                                                if={
                                                    this.state
                                                        .showApplicationSecurityForm ||
                                                    isEmpty
                                                }
                                            >
                                                <ApplicationSecurityForm
                                                    projectId={projectId}
                                                    componentId={componentId}
                                                    toggleForm={this.toggleForm}
                                                    showCancelBtn={!isEmpty}
                                                />
                                            </ShouldRender>
                                        </div>
                                    </div>
                                </span>
                                <ShouldRender
                                    if={
                                        !gettingApplicationSecurities &&
                                        !gettingSecurityLogs &&
                                        !this.state
                                            .showApplicationSecurityForm &&
                                        !isEmpty
                                    }
                                >
                                    <div
                                        className="Box-root Card-shadow--medium"
                                        tabIndex="0"
                                    >
                                        <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                            <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>
                                                        <span
                                                            id={`applicationsecurity_count`}
                                                            className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                                        >
                                                            <ShouldRender
                                                                if={
                                                                    numberOfPages >
                                                                    0
                                                                }
                                                            >
                                                                Page{' '}
                                                                {page
                                                                    ? page
                                                                    : 1}{' '}
                                                                of{' '}
                                                                {numberOfPages}{' '}
                                                                (
                                                                <ShouldRender
                                                                    if={
                                                                        appSecurities
                                                                    }
                                                                >
                                                                    <span id="numberOfApplicationSecurities">
                                                                        {count}
                                                                    </span>{' '}
                                                                    {count > 1
                                                                        ? 'total application securities'
                                                                        : 'Application security'}{' '}
                                                                </ShouldRender>
                                                                )
                                                            </ShouldRender>
                                                            <ShouldRender
                                                                if={
                                                                    !(
                                                                        numberOfPages >
                                                                        0
                                                                    )
                                                                }
                                                            >
                                                                <span id="numberOfApplicationSecurities">
                                                                    {count}{' '}
                                                                    {count > 1
                                                                        ? 'total application securities'
                                                                        : 'Application security'}
                                                                </span>
                                                            </ShouldRender>
                                                        </span>
                                                    </span>
                                                </span>
                                            </div>
                                            {fetchingPage ? (
                                                <ListLoader />
                                            ) : null}
                                            {error ? (
                                                <div
                                                    style={{
                                                        color: 'red',
                                                    }}
                                                >
                                                    {error}
                                                </div>
                                            ) : null}
                                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                                    <div className="Box-root Margin-right--8">
                                                        <button
                                                            id="btnPrev"
                                                            onClick={() =>
                                                                this.prevClicked(
                                                                    projectId,
                                                                    componentId,
                                                                    skip,
                                                                    limit
                                                                )
                                                            }
                                                            className={
                                                                'Button bs-ButtonLegacy' +
                                                                (canPrev
                                                                    ? ''
                                                                    : 'Is--disabled')
                                                            }
                                                            disabled={!canPrev}
                                                            data-db-analytics-name="list_view.pagination.previous"
                                                            type="button"
                                                        >
                                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                    <span>
                                                                        Previous
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </button>
                                                    </div>
                                                    <div className="Box-root">
                                                        <button
                                                            id="btnNext"
                                                            onClick={() =>
                                                                this.nextClicked(
                                                                    projectId,
                                                                    componentId,
                                                                    skip,
                                                                    limit
                                                                )
                                                            }
                                                            className={
                                                                'Button bs-ButtonLegacy' +
                                                                (canNext
                                                                    ? ''
                                                                    : 'Is--disabled')
                                                            }
                                                            disabled={!canNext}
                                                            data-db-analytics-name="list_view.pagination.next"
                                                            type="button"
                                                        >
                                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                    <span>
                                                                        Next
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

Application.displayName = 'Application Security Page';

Application.propTypes = {
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    slug: PropTypes.string,
    projectId: PropTypes.string,
    fetchComponent: PropTypes.func,
    getApplicationSecurities: PropTypes.func,
    applicationSecurities: PropTypes.array,
    getApplicationSecurityLogs: PropTypes.func,
    gettingSecurityLogs: PropTypes.bool,
    gettingApplicationSecurities: PropTypes.bool,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.object,
    // scanApplicationSecuritySuccess: PropTypes.func,
    // getApplicationSecuritySuccess: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
    currentProject: PropTypes.object,
    skip: PropTypes.number,
    limit: PropTypes.number,
    count: PropTypes.number,
    fetchingPage: PropTypes.bool,
    numberOfPage: PropTypes.number,
    error: PropTypes.oneOf([
        PropTypes.string,
        PropTypes.oneOfType([null, undefined]),
    ]),
};

const mapStateToProps = (state, props) => {
    const { componentSlug } = props.match.params;
    return {
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        slug: state.project.currentProject && state.project.currentProject.slug,
        applicationSecurities: state.security.applicationSecurities.securities,
        gettingSecurityLogs:
            state.security.getApplicationSecurityLog.requesting,
        gettingApplicationSecurities: state.security.getApplication.requesting,
        component:
            state.component && state.component.currentComponent.component,
        componentSlug,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        currentProject: state.project.currentProject,

        skip: state.security.applicationSecurities.skip,
        limit: state.security.applicationSecurities.limit,
        count: state.security.applicationSecurities.count,
        fetchingPage: state.security.applicationSecurities.fetchingPage,
        error: state.security.getApplication.error,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getApplicationSecurities,
            getApplicationSecurityLogs,
            scanApplicationSecuritySuccess,
            getApplicationSecuritySuccess,
            fetchComponent,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(Application);
