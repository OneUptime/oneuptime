import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import ContainerSecurityForm from '../components/security/ContainerSecurityForm';
import ContainerSecurity from '../components/security/ContainerSecurity';

import {
    getContainerSecurities,
    getContainerSecurityLogs,
    scanContainerSecuritySuccess,
    getContainerSecuritySuccess,
} from '../actions/security';
import { fetchComponent } from '../actions/component';
import { LargeSpinner, ListLoader } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import sortByName from '../utils/sortByName';
import { history } from '../store';
import { socket } from '../components/basic/Socket';

class Container extends Component {
    state = {
        showContainerSecurityForm: false,
        page: 1,
    };

    prevClicked = (projectId: $TSFixMe, componentId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurities' does not exist o... Remove this comment to see the full error message
            .getContainerSecurities({
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurities' does not exist o... Remove this comment to see the full error message
            .getContainerSecurities({
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurities' does not exist o... Remove this comment to see the full error message
            getContainerSecurities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurityLogs' does not exist... Remove this comment to see the full error message
            getContainerSecurityLogs,
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
            getContainerSecurityLogs({ projectId, componentId });

            // load container security
            getContainerSecurities({
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
            prevProps.componentId !== this.props.componentId
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurities' does not exist o... Remove this comment to see the full error message
                getContainerSecurities,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurityLogs' does not exist... Remove this comment to see the full error message
                getContainerSecurityLogs,
            } = this.props;
            if (projectId && componentId) {
                // load container security logs
                getContainerSecurityLogs({ projectId, componentId });

                // load container security
                getContainerSecurities({
                    projectId,
                    componentId,
                    skip: 0,
                    limit: 5,
                });
            }
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            prevProps.projectId !== this.props.projectId ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            prevProps.componentSlug !== this.props.componentSlug
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            const { projectId, fetchComponent, componentSlug } = this.props;
            if (projectId) {
                fetchComponent(projectId, componentSlug);
            }
        }
    }

    componentWillUnmount() {
        socket.removeListener(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            `createContainerSecurity-${this.props.componentId}`
        );
    }

    toggleForm = () =>
        this.setState(prevState => ({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showContainerSecurityForm' does not exis... Remove this comment to see the full error message
            showContainerSecurityForm: !prevState.showContainerSecurityForm,
        }));

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecurities' does not exist on t... Remove this comment to see the full error message
            containerSecurities: securities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'gettingContainerSecurities' does not exi... Remove this comment to see the full error message
            gettingContainerSecurities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'gettingSecurityLogs' does not exist on t... Remove this comment to see the full error message
            gettingSecurityLogs,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // scanContainerSecuritySuccess,
            // getContainerSecuritySuccess,
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
            securities && count && count > skip + limit ? true : false;
        const canPrev = securities && skip <= 0 ? false : true;
        const numberOfPages = numberOfPage
            ? numberOfPage
            : Math.ceil(parseInt(count) / limit);

        socket.emit('component_switch', componentId);

        socket.on(`createContainerSecurity-${componentId}`, (data: $TSFixMe) => {
            history.push(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                `/dashboard/project/${this.props.slug}/component/${componentSlug}/security/container/${data.slug}`
            );
        });

        const containerSecurities = securities ? sortByName(securities) : [];
        // containerSecurities.length > 0 &&
        //     containerSecurities.map(containerSecurity => {
        //         // join room
        //         socket.emit('security_switch', containerSecurity._id);

        //         socket.on(`security_${containerSecurity._id}`, data => {
        //             getContainerSecuritySuccess(data);
        //         });

        //         socket.on(`securityLog_${containerSecurity._id}`, data => {
        //             scanContainerSecuritySuccess(data);
        //         });

        //         return containerSecurity;
        //     });

        const componentName = component ? component.name : '';
        const projectName = currentProject ? currentProject.name : '';

        const isEmpty = containerSecurities.length === 0;
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
                    route={getParentRoute(pathname, null, 'component')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={pathname}
                    name={
                        this.state.showContainerSecurityForm || isEmpty
                            ? 'New Container Security'
                            : 'Container Security'
                    }
                    pageTitle="Container"
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: any; name: string; pageTitle: strin... Remove this comment to see the full error message
                    addBtn={!isEmpty}
                    btnText="Create Container Security"
                    toggleForm={this.toggleForm}
                />
                <div className="Margin-vertical--12">
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <ShouldRender
                                    if={
                                        gettingContainerSecurities &&
                                        gettingSecurityLogs
                                    }
                                >
                                    <div
                                        id="largeSpinner"
                                        style={{ textAlign: 'center' }}
                                    >
                                        <LargeSpinner />
                                    </div>
                                </ShouldRender>
                                <ShouldRender
                                    if={
                                        !gettingContainerSecurities &&
                                        !gettingSecurityLogs
                                    }
                                >
                                    {!this.state.showContainerSecurityForm &&
                                        !isEmpty &&
                                        containerSecurities.map(
                                            (containerSecurity: $TSFixMe) => {
                                                return (
                                                    <span
                                                        key={
                                                            containerSecurity._id
                                                        }
                                                    >
                                                        <div>
                                                            <div>
                                                                <ContainerSecurity
                                                                    name={
                                                                        containerSecurity.name
                                                                    }
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: any; dockerRegistryUrl: any; imagePa... Remove this comment to see the full error message
                                                                    dockerRegistryUrl={
                                                                        containerSecurity.dockerRegistryUrl
                                                                    }
                                                                    imagePath={
                                                                        containerSecurity.imagePath
                                                                    }
                                                                    containerSecurityId={
                                                                        containerSecurity._id
                                                                    }
                                                                    containerSecuritySlug={
                                                                        containerSecurity.slug
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
                                                        .showContainerSecurityForm ||
                                                    isEmpty
                                                }
                                            >
                                                <ContainerSecurityForm
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ componentId: any; projectId: any; toggleFo... Remove this comment to see the full error message
                                                    componentId={componentId}
                                                    projectId={projectId}
                                                    toggleForm={this.toggleForm}
                                                    showCancelBtn={!isEmpty}
                                                />
                                            </ShouldRender>
                                        </div>
                                    </div>
                                </span>
                                <ShouldRender
                                    if={
                                        !gettingContainerSecurities &&
                                        !gettingSecurityLogs &&
                                        !this.state.showContainerSecurityForm &&
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
                                                            id={`containersecurity_count`}
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
                                                                        securities
                                                                    }
                                                                >
                                                                    <span id="numberOfContainerSecurities">
                                                                        {count}
                                                                    </span>{' '}
                                                                    {count > 1
                                                                        ? 'total container securities'
                                                                        : 'Container security'}{' '}
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
                                                                <span id="numberOfContainerSecurities">
                                                                    {count}{' '}
                                                                    {count > 1
                                                                        ? 'total container securities'
                                                                        : 'Container security'}
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
Container.displayName = 'Container Security Page';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Container.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    fetchComponent: PropTypes.func,
    slug: PropTypes.string,
    containerSecurities: PropTypes.array,
    getContainerSecurities: PropTypes.func,
    getContainerSecurityLogs: PropTypes.func,
    gettingSecurityLogs: PropTypes.bool,
    gettingContainerSecurities: PropTypes.bool,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.object,
    // scanContainerSecuritySuccess: PropTypes.func,
    // getContainerSecuritySuccess: PropTypes.func,
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
    skip: PropTypes.number,
    limit: PropTypes.number,
    count: PropTypes.number,
    fetchingPage: PropTypes.bool,
    numberOfPage: PropTypes.number,
    error: PropTypes.string,
};

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    // ids from url
    const { componentSlug } = ownProps.match.params;

    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        slug: state.project.currentProject && state.project.currentProject.slug,
        containerSecurities: state.security.containerSecurities.securities,
        gettingSecurityLogs: state.security.getContainerSecurityLog.requesting,
        gettingContainerSecurities: state.security.getContainer.requesting,
        component:
            state.component && state.component.currentComponent.component,
        componentSlug,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        skip: state.security.containerSecurities.skip,
        limit: state.security.containerSecurities.limit,
        count: state.security.containerSecurities.count,
        fetchingPage: state.security.containerSecurities.fetchingPage,
        error: state.security.getContainer.error,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        getContainerSecurities,
        getContainerSecurityLogs,
        scanContainerSecuritySuccess,
        getContainerSecuritySuccess,
        fetchComponent,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(Container);
