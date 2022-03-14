import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import getParentRoute from '../utils/getParentRoute';
import { bindActionCreators } from 'redux';

import { loadPage } from '../actions/page';
import { ListLoader, LoadingState } from '../components/basic/Loader';
import { fetchPerformanceTrackers } from '../actions/performanceTracker';
import NewPerformanceTracker from '../components/performanceTracker/NewPerformanceTracker';
import { fetchComponent } from '../actions/component';
import PerformanceTrackerList from '../components/performanceTracker/PerformanceTrackerList';

class PerformanceTracker extends Component {
    state = {
        showNewPerformanceTrackerForm: false,
        page: 1,
        requesting: false,
    };

    prevClicked = (projectId: $TSFixMe, componentId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPerformanceTrackers' does not exist... Remove this comment to see the full error message
            .fetchPerformanceTrackers({
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPerformanceTrackers' does not exist... Remove this comment to see the full error message
            .fetchPerformanceTrackers({
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'loadPage' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.loadPage('Performance Tracker');
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, fetchComponent, componentSlug } = this.props;
        if (currentProject) {
            this.setState({ requesting: true });
            fetchComponent(currentProject._id, componentSlug).then(() => {
                this.ready();
            });
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps.currentProject !== this.props.currentProject ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            prevProps.componentId !== this.props.componentId ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            prevProps.componentSlug !== this.props.componentSlug
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            const componentId = this.props.componentId;
            const projectId =
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject && this.props.currentProject._id;
            if (projectId) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                this.props.fetchComponent(projectId, this.props.componentSlug);
            }
            if (projectId && componentId) {
                this.setRequesting();
                this.props
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPerformanceTrackers' does not exist... Remove this comment to see the full error message
                    .fetchPerformanceTrackers({
                        projectId,
                        componentId,
                        skip: 0,
                        limit: 5,
                    })
                    .then(() => this.setState({ requesting: false }));
            }
        }
    }

    setRequesting = () => this.setState({ requesting: true });

    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        const componentId = this.props.componentId;
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject && this.props.currentProject._id;
        if (projectId && componentId) {
            this.props
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPerformanceTrackers' does not exist... Remove this comment to see the full error message
                .fetchPerformanceTrackers({
                    projectId,
                    componentId,
                    skip: 0,
                    limit: 5,
                })
                .then(() => this.setState({ requesting: false }));
        }
    };

    renderPerformanceTrackerList = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTrackerList' does not exist o... Remove this comment to see the full error message
            performanceTrackerList,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectSlug' does not exist on type 'Rea... Remove this comment to see the full error message
            projectSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
        } = this.props;
        return performanceTrackerList.performanceTrackers.map(
            (performanceTracker: $TSFixMe) => <PerformanceTrackerList
                key={performanceTracker.name}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ key: any; performanceTracker: any; compone... Remove this comment to see the full error message
                performanceTracker={performanceTracker}
                componentSlug={componentSlug}
                projectSlug={projectSlug}
                projectId={component.projectId._id || component.projectId}
                requesting={performanceTrackerList.requesting}
            />
        );
    };

    toggleForm = () =>
        this.setState(prevState => ({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showNewPerformanceTrackerForm' does not ... Remove this comment to see the full error message
            showNewPerformanceTrackerForm: !prevState.showNewPerformanceTrackerForm,
        }));

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (this.props.currentProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            document.title = this.props.currentProject.name + ' Dashboard';
        }
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTrackerList' does not exist o... Remove this comment to see the full error message
            performanceTrackerList,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'numberOfPage' does not exist on type 'Re... Remove this comment to see the full error message
            numberOfPage,
        } = this.props;

        const skip = performanceTrackerList.skip;
        const limit = performanceTrackerList.limit;
        const count = performanceTrackerList.count;
        const error = performanceTrackerList.error;
        const fetchingPage = performanceTrackerList.fetchingPage;
        const componentId = component?._id;
        const page = this.state.page;
        const canNext =
            performanceTrackerList && count && count > skip + limit
                ? true
                : false;
        const canPrev = performanceTrackerList && skip <= 0 ? false : true;
        const numberOfPages = numberOfPage
            ? numberOfPage
            : Math.ceil(parseInt(count) / limit);

        const componentName = component ? component.name : '';
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';

        const isEmpty =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTrackerList' does not exist o... Remove this comment to see the full error message
            this.props.performanceTrackerList.performanceTrackers.length === 0;
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
                    route={getParentRoute(pathname, null, 'component-tracker')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={pathname}
                    name={
                        this.state.showNewPerformanceTrackerForm || isEmpty
                            ? 'New Performance Tracker'
                            : 'Performance Tracker'
                    }
                    pageTitle="Performance Tracker"
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: any; name: string; pageTitle: strin... Remove this comment to see the full error message
                    addBtn={!isEmpty}
                    btnText="Create New Performance Tracker"
                    toggleForm={this.toggleForm}
                />
                <div>
                    <div>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTrackerList' does not exist o... Remove this comment to see the full error message
                                this.props.performanceTrackerList.requesting ||
                                this.state.requesting
                            }
                        >
                            <LoadingState />
                        </ShouldRender>
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTrackerList' does not exist o... Remove this comment to see the full error message
                        {!this.props.performanceTrackerList.requesting &&
                            !this.state.requesting &&
                            !this.state.showNewPerformanceTrackerForm &&
                            !isEmpty &&
                            this.renderPerformanceTrackerList()}
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTrackerList' does not exist o... Remove this comment to see the full error message
                                !this.props.performanceTrackerList.requesting &&
                                !this.state.requesting
                            }
                        >
                            <div className="db-RadarRulesLists-page">
                                <ShouldRender
                                    if={
                                        this.state
                                            .showNewPerformanceTrackerForm ||
                                        isEmpty
                                    }
                                >
                                    <NewPerformanceTracker
                                        index={2000}
                                        formKey="NewPerformanceTrackerForm"
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                        componentId={this.props.componentId}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                                        componentSlug={this.props.componentSlug}
                                        toggleForm={this.toggleForm}
                                        showCancelBtn={!isEmpty}
                                    />
                                </ShouldRender>
                            </div>
                        </ShouldRender>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTrackerList' does not exist o... Remove this comment to see the full error message
                                !this.props.performanceTrackerList.requesting &&
                                !this.state.requesting &&
                                !this.state.showNewPerformanceTrackerForm &&
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
                                                    id={`performancetracker_count`}
                                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                                >
                                                    <ShouldRender
                                                        if={numberOfPages > 0}
                                                    >
                                                        Page {page ? page : 1}{' '}
                                                        of {numberOfPages} (
                                                        <ShouldRender
                                                            if={
                                                                performanceTrackerList
                                                            }
                                                        >
                                                            <span id="numberOfPerformance">
                                                                {count}
                                                            </span>{' '}
                                                            {count > 1
                                                                ? 'total performance trackers'
                                                                : 'Performance tracker'}{' '}
                                                        </ShouldRender>
                                                        )
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={
                                                            !(numberOfPages > 0)
                                                        }
                                                    >
                                                        <span id="numberOfPerformance">
                                                            {count}{' '}
                                                            {count > 1
                                                                ? 'total application logs'
                                                                : 'Performance tracker'}
                                                        </span>
                                                    </ShouldRender>
                                                </span>
                                            </span>
                                        </span>
                                    </div>
                                    {fetchingPage ? <ListLoader /> : null}
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
                                                            <span>Next</span>
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
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
PerformanceTracker.displayName = 'PerformanceTracker';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            fetchPerformanceTrackers,
            loadPage,
            fetchComponent,
        },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const currentProject = state.project.currentProject;
    const { componentSlug, slug } = ownProps.match.params;

    return {
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        component:
            state.component && state.component.currentComponent.component,
        componentSlug,
        projectSlug: slug,
        currentProject,
        performanceTrackerList: state.performanceTracker.performanceTrackerList,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
PerformanceTracker.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.object,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    loadPage: PropTypes.func,
    currentProject: PropTypes.object,
    fetchPerformanceTrackers: PropTypes.func,
    performanceTrackerList: PropTypes.object,
    fetchComponent: PropTypes.func,
    projectSlug: PropTypes.string,
    switchToProjectViewerNav: PropTypes.bool,
    numberOfPage: PropTypes.number,
};

export default connect(mapStateToProps, mapDispatchToProps)(PerformanceTracker);
