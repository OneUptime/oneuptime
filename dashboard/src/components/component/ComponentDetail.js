import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    fetchComponents,
    fetchComponentResources,
    addCurrentComponent,
    searchComponents,
} from '../../actions/component';
import { fetchMonitors } from '../../actions/monitor';
import { closeModal } from '../../actions/modal';
import { deleteComponent } from '../../actions/component';
import ShouldRender from '../basic/ShouldRender';
import Badge from '../common/Badge';
import { history } from '../../store';
import { logEvent } from '../../analytics';
import { IS_SAAS_SERVICE } from '../../config';
import ResourceTabularList from './ResourceTabularList';
import { animateSidebar } from '../../actions/animateSidebar';

export class ComponentDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    prevClicked = () => {
        const { component } = this.props;
        this.props.fetchComponents(
            component.projectId._id,
            component._id,
            component.skip ? parseInt(component.skip, 10) - 3 : 3,
            3
        );
        this.props.fetchComponentResources(
            component.projectId._id,
            component._id,
            component.skip ? parseInt(component.skip, 5) - 5 : 5,
            5
        );
        if (IS_SAAS_SERVICE) {
            logEvent(
                'EVENT: DASHBOARD > COMPONENT > MONITOR PREVIOUS BUTTON CLICKED',
                {
                    ProjectId: this.props.component.projectId._id,
                    componentId: this.props.component._id,
                    skip: this.props.component.skip
                        ? parseInt(this.props.component.skip, 10) - 3
                        : 3,
                }
            );
        }
    };

    nextClicked = () => {
        const { component } = this.props;
        this.props.fetchComponents(
            component.projectId._id,
            component._id,
            component.skip ? parseInt(component.skip, 10) + 3 : 3,
            3
        );
        this.props.fetchComponentResources(
            component.projectId._id,
            component._id,
            component.skip ? parseInt(component.skip, 5) + 5 : 5,
            5
        );
        if (IS_SAAS_SERVICE) {
            logEvent(
                'EVENT: DASHBOARD > COMPONENT > MONITOR PREVIOUS BUTTON CLICKED',
                {
                    ProjectId: this.props.component.projectId._id,
                    componentId: this.props.component._id,
                    skip: this.props.component.skip
                        ? parseInt(this.props.component.skip, 10) + 3
                        : 3,
                }
            );
        }
    };

    handleKeyBoard = e => {
        const canNext =
            this.props.component &&
            this.props.component.count &&
            this.props.component.count >
                this.props.component.skip + this.props.component.limit
                ? true
                : false;
        const canPrev =
            this.props.component && this.props.component.skip <= 0
                ? false
                : true;
        switch (e.key) {
            case 'ArrowRight':
                return canNext && this.nextClicked();
            case 'ArrowLeft':
                return canPrev && this.prevClicked();
            default:
                return false;
        }
    };

    deleteComponent = componentId => {
        const projectId =
            this.props.component.projectId._id ||
            this.props.component.projectId;
        const promise = this.props.deleteComponent(componentId, projectId);
        history.push(
            `/dashboard/project/${this.props.currentProject.slug}/components`
        );
        if (IS_SAAS_SERVICE) {
            logEvent('EVENT: DASHBOARD > COMPONENT > COMPONENT DELETED', {
                ProjectId: this.props.currentProject._id,
                componentId,
            });
        }
        return promise;
    };
    componentDidMount() {
        const { component, currentProject } = this.props;
        this.props.fetchComponentResources(
            component.projectId._id,
            component._id,
            0,
            5
        );
        this.props.fetchMonitors(currentProject._id);
    }
    // componentDidUpdate(prevState) {
    //     const { component } = this.props;

    //     if (
    //         prevState.searchValues &&
    //         prevState.searchValues.search !== this.props.searchValues &&
    //         this.props.searchValues.search && this.props.searchValues &&
    //         this.props.searchValues.search !== ''
    //     ) {
    //         console.log('running')
    //         this.props.searchComponents(
    //             component.projectId._id,
    //             this.props.searchValues
    //         );
    //     }
    //     //
    // }

    render() {
        const { component, componentState, currentProject } = this.props;
        component.error = null;
        if (
            componentState.componentList.error &&
            componentState.componentList.error.componentId &&
            component &&
            component._id
        ) {
            if (
                componentState.componentList.error.componentId === component._id
            ) {
                component.error = componentState.componentList.error.error;
            }
        }
        component.success = componentState.componentList.success;
        component.requesting = componentState.componentList.requesting;

        return (
            <div
                className="Box-root Card-shadow--medium"
                tabIndex="0"
                onKeyDown={this.handleKeyBoard}
            >
                <ShouldRender if={this.props.shouldRenderProjectType}>
                    <div className="Box-root Padding-top--20 Padding-left--20">
                        <Badge
                            id={`badge_${this.props.projectName}`}
                            color={
                                this.props.projectType === 'project'
                                    ? 'red'
                                    : 'blue'
                            }
                        >
                            {this.props.projectName}
                        </Badge>
                    </div>
                </ShouldRender>
                <div className="db-Trends-header">
                    <div className="db-Trends-controls">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span className="Box-root Flex-flex Flex-direction--row">
                                        <span
                                            className="db-SideNav-icon db-SideNav-icon--square db-SideNav-icon--selected"
                                            style={{
                                                backgroundRepeat: 'no-repeat',
                                                backgroundSize: '15px',
                                                backgroundPosition: 'center',
                                                margin: '3px 3px',
                                            }}
                                        />
                                        <span
                                            id="component-content-header"
                                            className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                        >
                                            <span
                                                id={`component-title-${component.name}`}
                                            >
                                                {component.name}
                                            </span>
                                        </span>
                                    </span>
                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Here&apos;s a list of resources
                                            which belong to this component.
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div>
                            <button
                                id={`more-details-${component.name}`}
                                className="bs-Button"
                                type="button"
                                onClick={() => {
                                    setTimeout(() => {
                                        history.push(
                                            '/dashboard/project/' +
                                                currentProject.slug +
                                                '/component/' +
                                                component.slug +
                                                '/monitoring'
                                        );
                                        this.props.animateSidebar(false);
                                    }, 200);
                                    this.props.animateSidebar(true);
                                    this.props.addCurrentComponent(component);
                                }}
                            >
                                View Component
                            </button>
                        </div>
                    </div>
                </div>
                {component ? (
                    <div>
                        <div className="db-RadarRulesLists-page">
                            <div className="Box-root Margin-bottom--12">
                                <div className="">
                                    <div className="Box-root">
                                        <div>
                                            <ResourceTabularList
                                                componentId={
                                                    this.props.component._id
                                                }
                                                componentSlug={
                                                    this.props.component.slug
                                                }
                                                componentResources={
                                                    this.props
                                                        .componentResources
                                                }
                                                currentProject={
                                                    this.props.currentProject
                                                }
                                                componentName={component.name}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }
}

ComponentDetail.displayName = 'ComponentDetail';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            closeModal,
            deleteComponent,
            fetchComponents,
            addCurrentComponent,
            fetchComponentResources,
            fetchMonitors,
            animateSidebar,
            searchComponents,
        },
        dispatch
    );
};

function mapStateToProps(state, props) {
    const componentMonitors = (
        state.monitor.monitorsList.monitors.find(
            o => o._id === props.projectId
        ) || {
            monitors: [],
        }
    ).monitors.filter(
        monitor =>
            monitor.componentId &&
            monitor.componentId._id === props.component._id
    );
    const searchValues = state.form.search && state.form.search.values;
    return {
        componentMonitors,
        componentState: state.component,
        currentProject: state.project.currentProject,
        subProject: state.subProject,
        componentResources: state.component.componentResourceList,
        searchValues,
    };
}

ComponentDetail.propTypes = {
    currentProject: PropTypes.object.isRequired,
    component: PropTypes.object.isRequired,
    componentState: PropTypes.object.isRequired,
    deleteComponent: PropTypes.func,
    fetchComponents: PropTypes.func,
    addCurrentComponent: PropTypes.func,
    projectName: PropTypes.string,
    projectType: PropTypes.string,
    shouldRenderProjectType: PropTypes.bool,
    fetchComponentResources: PropTypes.func,
    componentResources: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.array,
    ]),
    fetchMonitors: PropTypes.func,
    animateSidebar: PropTypes.func,
    searchComponents: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(ComponentDetail);
