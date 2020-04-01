import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import MonitorTabularList from '../monitor/MonitorTabularList';
import uuid from 'uuid';
import { fetchMonitorLogs } from '../../actions/monitor';
import { fetchComponents } from '../../actions/component';
import { openModal, closeModal } from '../../actions/modal';
import DeleteComponent from '../modals/DeleteComponent';
import { deleteComponent } from '../../actions/component';
import DataPathHoC from '../DataPathHoC';
import ShouldRender from '../basic/ShouldRender';
import Badge from '../common/Badge';
import { history } from '../../store';
import { logEvent } from '../../analytics';
import { IS_SAAS_SERVICE } from '../../config';

export class ComponentDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            deleteComponentModalId: uuid.v4(),
        };
    }

    prevClicked = () => {
        this.props.fetchComponents(
            this.props.component.projectId._id,
            this.props.component._id,
            this.props.component.skip
                ? parseInt(this.props.component.skip, 10) - 3
                : 3,
            3
        );
        if (IS_SAAS_SERVICE) {
            logEvent('Previous Monitor Requested', {
                ProjectId: this.props.component.projectId._id,
                componentId: this.props.component._id,
                skip: this.props.component.skip
                    ? parseInt(this.props.component.skip, 10) - 3
                    : 3,
            });
        }
    };

    nextClicked = () => {
        this.props.fetchComponents(
            this.props.component.projectId._id,
            this.props.component._id,
            this.props.component.skip
                ? parseInt(this.props.component.skip, 10) + 3
                : 3,
            3
        );
        if (IS_SAAS_SERVICE) {
            logEvent('Next Monitor Requested', {
                ProjectId: this.props.component.projectId._id,
                componentId: this.props.component._id,
                skip: this.props.component.skip
                    ? parseInt(this.props.component.skip, 10) + 3
                    : 3,
            });
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
            `/dashboard/project/${this.props.currentProject._id}/components`
        );
        if (IS_SAAS_SERVICE) {
            logEvent('Component Deleted', {
                ProjectId: this.props.currentProject._id,
                componentId,
            });
        }
        return promise;
    };

    render() {
        const { deleteComponentModalId } = this.state;
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
                                    <span
                                        id="component-content-header"
                                        className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                    >
                                        <span
                                            id={`component-title-${component.name}`}
                                        >
                                            {component.name}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div>
                            <button
                                id={`more-details-${component.name}`}
                                className="bs-Button bs-Button--icon bs-Button--help"
                                type="button"
                                onClick={() => {
                                    history.push(
                                        '/dashboard/project/' +
                                            currentProject._id +
                                            '/' +
                                            component._id +
                                            '/monitoring'
                                    );
                                }}
                            >
                                <span>View</span>
                            </button>
                            <button
                                id={`delete-component-${component.name}`}
                                className="bs-Button bs-Button--icon bs-Button--delete"
                                type="button"
                                onClick={() =>
                                    this.props.openModal({
                                        id: deleteComponentModalId,
                                        onClose: () => '',
                                        onConfirm: () =>
                                            this.deleteComponent(component._id),
                                        content: DataPathHoC(DeleteComponent, {
                                            component: this.props.component,
                                        }),
                                    })
                                }
                            >
                                <span>Delete</span>
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
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-bottom--16">
                                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                        <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Here&apos;s a
                                                                list of
                                                                resources which
                                                                belong to this
                                                                component.
                                                            </span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <MonitorTabularList
                                                componentId={
                                                    this.props.component._id
                                                }
                                                monitors={
                                                    this.props.componentMonitors
                                                }
                                                prevClicked={this.prevClicked}
                                                nextClicked={this.nextClicked}
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
            openModal,
            closeModal,
            deleteComponent,
            fetchComponents,
            fetchMonitorLogs,
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
    ).monitors.filter(monitor => monitor.componentId === props.component._id);
    return {
        componentMonitors,
        componentState: state.component,
        currentProject: state.project.currentProject,
        subProject: state.subProject,
    };
}

ComponentDetail.propTypes = {
    currentProject: PropTypes.object.isRequired,
    component: PropTypes.object.isRequired,
    componentMonitors: PropTypes.array.isRequired,
    componentState: PropTypes.object.isRequired,
    openModal: PropTypes.func,
    deleteComponent: PropTypes.func,
    fetchComponents: PropTypes.func,
    projectName: PropTypes.string,
    projectType: PropTypes.string,
    shouldRenderProjectType: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(ComponentDetail);
