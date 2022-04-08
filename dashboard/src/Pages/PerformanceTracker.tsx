import React, { Component } from 'react';

import { Fade } from 'react-awesome-reveal';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import getParentRoute from '../utils/getParentRoute';
import { bindActionCreators, Dispatch } from 'redux';

import { loadPage } from '../actions/page';
import { ListLoader, LoadingState } from '../components/basic/Loader';
import { fetchPerformanceTrackers } from '../actions/performanceTracker';
import NewPerformanceTracker from '../components/performanceTracker/NewPerformanceTracker';
import { fetchComponent } from '../actions/component';
import PerformanceTrackerList from '../components/performanceTracker/PerformanceTrackerList';

interface PerformanceTrackerProps {
    location?: {
        pathname?: string
    };
    component?: object;
    componentId?: string;
    componentSlug?: string;
    loadPage?: Function;
    currentProject?: object;
    fetchPerformanceTrackers?: Function;
    performanceTrackerList?: object;
    fetchComponent?: Function;
    projectSlug?: string;
    switchToProjectViewerNav?: boolean;
    numberOfPage?: number;
}

class PerformanceTracker extends Component<ComponentProps> {
    state = {
        showNewPerformanceTrackerForm: false,
        page: 1,
        requesting: false,
    };

    prevClicked = (projectId: string, componentId: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) => {
        this.props

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

                            prevState.page === 1

                                ? prevState.page

                                : prevState.page - 1,
                    };
                });
            });
    };

    nextClicked = (projectId: string, componentId: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) => {
        this.props

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

                        page: prevState.page + 1,
                    };
                });
            });
    };

    override componentDidMount() {

        this.props.loadPage('Performance Tracker');

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

            prevProps.currentProject !== this.props.currentProject ||

            prevProps.componentId !== this.props.componentId ||

            prevProps.componentSlug !== this.props.componentSlug
        ) {

            const componentId = this.props.componentId;
            const projectId =

                this.props.currentProject && this.props.currentProject._id;
            if (projectId) {

                this.props.fetchComponent(projectId, this.props.componentSlug);
            }
            if (projectId && componentId) {
                this.setRequesting();
                this.props

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

        const componentId = this.props.componentId;
        const projectId =

            this.props.currentProject && this.props.currentProject._id;
        if (projectId && componentId) {
            this.props

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

            performanceTrackerList,

            componentSlug,

            projectSlug,

            component,
        } = this.props;
        return performanceTrackerList.performanceTrackers.map(
            (performanceTracker: $TSFixMe) => <PerformanceTrackerList
                key={performanceTracker.name}

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

            showNewPerformanceTrackerForm: !prevState.showNewPerformanceTrackerForm,
        }));

    override render() {

        if (this.props.currentProject) {

            document.title = this.props.currentProject.name + ' Dashboard';
        }
        const {

            location: { pathname },

            component,

            currentProject,

            switchToProjectViewerNav,

            performanceTrackerList,

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

            this.props.performanceTrackerList.performanceTrackers.length === 0;
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

                    addBtn={!isEmpty}
                    btnText="Create New Performance Tracker"
                    toggleForm={this.toggleForm}
                />
                <div>
                    <div>
                        <ShouldRender
                            if={

                                this.props.performanceTrackerList.requesting ||
                                this.state.requesting
                            }
                        >
                            <LoadingState />
                        </ShouldRender>

                        {!this.props.performanceTrackerList.requesting &&
                            !this.state.requesting &&
                            !this.state.showNewPerformanceTrackerForm &&
                            !isEmpty &&
                            this.renderPerformanceTrackerList()}
                        <ShouldRender
                            if={

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

                                        componentId={this.props.componentId}

                                        componentSlug={this.props.componentSlug}
                                        toggleForm={this.toggleForm}
                                        showCancelBtn={!isEmpty}
                                    />
                                </ShouldRender>
                            </div>
                        </ShouldRender>
                        <ShouldRender
                            if={

                                !this.props.performanceTrackerList.requesting &&
                                !this.state.requesting &&
                                !this.state.showNewPerformanceTrackerForm &&
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


PerformanceTracker.displayName = 'PerformanceTracker';

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchPerformanceTrackers,
            loadPage,
            fetchComponent,
        },
        dispatch
    );
};

const mapStateToProps = (state: RootState, ownProps: $TSFixMe) => {
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
