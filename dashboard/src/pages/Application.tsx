import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
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

    prevClicked = (projectId: $TSFixMe, componentId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurities' does not exist... Remove this comment to see the full error message
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

    nextClicked = (projectId: $TSFixMe, componentId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurities' does not exist... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        page: prevState.page + 1,
                    };
                });
            });
    };

    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurities' does not exist... Remove this comment to see the full error message
            getApplicationSecurities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurityLogs' does not exi... Remove this comment to see the full error message
            getApplicationSecurityLogs,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
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

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            prevProps.projectId !== this.props.projectId ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            prevProps.componentId !== this.props.componentId ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            prevProps.componentSlug !== this.props.componentSlug
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                componentSlug,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                fetchComponent,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurities' does not exist... Remove this comment to see the full error message
                getApplicationSecurities,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurityLogs' does not exi... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            `createApplicationSecurity-${this.props.componentId}`
        );
    }

    toggleForm = () =>
        this.setState(prevState => ({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showApplicationSecurityForm' does not ex... Remove this comment to see the full error message
            showApplicationSecurityForm: !prevState.showApplicationSecurityForm,
        }));

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecurities' does not exist on... Remove this comment to see the full error message
            applicationSecurities: appSecurities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'gettingApplicationSecurities' does not e... Remove this comment to see the full error message
            gettingApplicationSecurities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'gettingSecurityLogs' does not exist on t... Remove this comment to see the full error message
            gettingSecurityLogs,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // scanApplicationSecuritySuccess,
            // getApplicationSecuritySuccess,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            skip,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'limit' does not exist on type 'Readonly<... Remove this comment to see the full error message
            limit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            count,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchingPage' does not exist on type 'Re... Remove this comment to see the full error message
            fetchingPage,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'numberOfPage' does not exist on type 'Re... Remove this comment to see the full error message
            numberOfPage,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
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

        socket.on(`createApplicationSecurity-${componentId}`, (data: $TSFixMe) => {
            history.push(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: any; name: string; pageTitle: strin... Remove this comment to see the full error message
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
                                            (applicationSecurity: $TSFixMe) => {
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
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; componentId: any; toggleFo... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Application.displayName = 'Application Security Page';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
    error: PropTypes.string,
};

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
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
