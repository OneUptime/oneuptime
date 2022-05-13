import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import {
    fetchComponentResources,
    addCurrentComponent,
} from '../../actions/component';
import { closeModal } from 'CommonUI/actions/Modal';
import { deleteComponent } from '../../actions/component';
import ShouldRender from '../basic/ShouldRender';
import Badge from '../common/Badge';
import { history, RootState } from '../../store';
import ResourceTabularList from './ResourceTabularList';
import { animateSidebar } from '../../actions/animateSidebar';

interface ComponentDetailProps {
    currentProject: object;
    component: object;
    componentState: object;
    deleteComponent?: Function;
    addCurrentComponent?: Function;
    projectName?: string;
    projectType?: string;
    shouldRenderProjectType?: boolean;
    fetchComponentResources?: Function;
    componentResources?: object | unknown[];
    animateSidebar?: Function;
}

export class ComponentDetail extends Component<ComponentDetailProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
    }

    prevClicked = () => {

        const { component }: $TSFixMe = this.props;

        this.props.fetchComponentResources(
            component.projectId._id,
            component._id,
            component.skip ? parseInt(component.skip, 5) - 5 : 5,
            5
        );
    };

    nextClicked = () => {

        const { component }: $TSFixMe = this.props;

        this.props.fetchComponentResources(
            component.projectId._id,
            component._id,
            component.skip ? parseInt(component.skip, 5) + 5 : 5,
            5
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {
        const canNext: $TSFixMe =

            this.props.component &&

                this.props.component.count &&

                this.props.component.count >

                this.props.component.skip + this.props.component.limit
                ? true
                : false;
        const canPrev: $TSFixMe =

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
        const projectId: $TSFixMe =

            this.props.component.projectId._id ||

            this.props.component.projectId;

        const promise: $TSFixMe = this.props.deleteComponent(componentId, projectId);
        history.push(

            `/dashboard/project/${this.props.currentProject.slug}/components`
        );

        return promise;
    };
    override componentDidMount() {

        const { component }: $TSFixMe = this.props;

        this.props.fetchComponentResources(
            component.projectId._id,
            component._id,
            0,
            5
        );
    }

    override render() {

        const { component, componentState, currentProject }: $TSFixMe = this.props;
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

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
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

function mapStateToProps(state: RootState, props: $TSFixMe) {
    const componentMonitors: Function = (
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
