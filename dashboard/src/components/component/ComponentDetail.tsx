import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    fetchComponentResources,
    addCurrentComponent,
} from '../../actions/component';
import { closeModal } from '../../actions/modal';
import { deleteComponent } from '../../actions/component';
import ShouldRender from '../basic/ShouldRender';
import Badge from '../common/Badge';
import { history } from '../../store';
import ResourceTabularList from './ResourceTabularList';
import { animateSidebar } from '../../actions/animateSidebar';

export class ComponentDetail extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
    }

    prevClicked = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
        const { component } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponentResources' does not exist ... Remove this comment to see the full error message
        this.props.fetchComponentResources(
            component.projectId._id,
            component._id,
            component.skip ? parseInt(component.skip, 5) - 5 : 5,
            5
        );
    };

    nextClicked = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
        const { component } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponentResources' does not exist ... Remove this comment to see the full error message
        this.props.fetchComponentResources(
            component.projectId._id,
            component._id,
            component.skip ? parseInt(component.skip, 5) + 5 : 5,
            5
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {
        const canNext =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.component &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.component.count &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.component.count >
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.component.skip + this.props.component.limit
                ? true
                : false;
        const canPrev =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
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

    deleteComponent = (componentId: $TSFixMe) => {
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.component.projectId._id ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.component.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteComponent' does not exist on type ... Remove this comment to see the full error message
        const promise = this.props.deleteComponent(componentId, projectId);
        history.push(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            `/dashboard/project/${this.props.currentProject.slug}/components`
        );

        return promise;
    };
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
        const { component } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponentResources' does not exist ... Remove this comment to see the full error message
        this.props.fetchComponentResources(
            component.projectId._id,
            component._id,
            0,
            5
        );
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="0"
                onKeyDown={this.handleKeyBoard}
            >
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'shouldRenderProjectType' does not exist ... Remove this comment to see the full error message
                <ShouldRender if={this.props.shouldRenderProjectType}>
                    <div className="Box-root Padding-top--20 Padding-left--20">
                        <Badge
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectName' does not exist on type 'Rea... Remove this comment to see the full error message
                            id={`badge_${this.props.projectName}`}
                            color={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectType' does not exist on type 'Rea... Remove this comment to see the full error message
                                this.props.projectType === 'project'
                                    ? 'red'
                                    : 'blue'
                            }
                        >
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectName' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
                                        this.props.animateSidebar(false);
                                    }, 200);
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
                                    this.props.animateSidebar(true);
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCurrentComponent' does not exist on t... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                    this.props.component._id
                                                }
                                                componentSlug={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                    this.props.component.slug
                                                }
                                                componentResources={
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentResources' does not exist on ty... Remove this comment to see the full error message
                                                        .componentResources
                                                }
                                                currentProject={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ComponentDetail.displayName = 'ComponentDetail';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            closeModal,
            deleteComponent,
            addCurrentComponent,
            fetchComponentResources,
            animateSidebar,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe, props: $TSFixMe) {
    const componentMonitors = (
        state.monitor.monitorsList.monitors.find(
            (o: $TSFixMe) => o._id === props.projectId
        ) || {
            monitors: [],
        }
    ).monitors.filter(
        (monitor: $TSFixMe) => monitor.componentId &&
        monitor.componentId._id === props.component._id
    );
    return {
        componentMonitors,
        componentState: state.component,
        currentProject: state.project.currentProject,
        subProject: state.subProject,
        componentResources: state.component.componentResourceList,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ComponentDetail.propTypes = {
    currentProject: PropTypes.object.isRequired,
    component: PropTypes.object.isRequired,
    componentState: PropTypes.object.isRequired,
    deleteComponent: PropTypes.func,
    addCurrentComponent: PropTypes.func,
    projectName: PropTypes.string,
    projectType: PropTypes.string,
    shouldRenderProjectType: PropTypes.bool,
    fetchComponentResources: PropTypes.func,
    componentResources: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.array,
    ]),
    animateSidebar: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(ComponentDetail);
