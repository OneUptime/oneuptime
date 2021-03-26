import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import { changeMonitorComponent } from '../../actions/monitor';
import DataPathHoC from '../DataPathHoC';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import ChangeMonitorComponent from '../modals/ChangeMonitorComponent';
import { history } from '../../store';

class MonitorViewChangeComponentBox extends Component {
    constructor(props) {
        super(props);
        this.state = { changeMonitorComponentModalId: uuidv4() };
    }

    handleMonitorComponentChanged = async (
        monitor,
        oldComponentId,
        newComponent
    ) => {
        const { currentProject } = this.props;

        const { projectId, _id: monitorId, componentId, slug } = monitor;

        const redirectTo = `/dashboard/project/${
            currentProject.slug
        }/${newComponent && newComponent.slug}/monitoring/${slug}`;
        history.push(redirectTo);

        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > MONITOR COMPONENT CHANGED',
                {
                    projectId,
                    monitorId,
                    oldComponentId,
                    newComponentId: componentId,
                }
            );
        }

        this.props.closeModal({
            id: this.state.changeMonitorComponentModalId,
        });

        return;
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.state.changeMonitorComponentModalId,
                });
            default:
                return false;
        }
    };

    render() {
        let changingComponent = false;
        if (
            this.props.monitorState &&
            this.props.monitorState.changeMonitorComponent &&
            this.props.monitorState.changeMonitorComponent ===
                this.props.monitor._id
        ) {
            changingComponent = true;
        }
        const { changeMonitorComponentModalId } = this.state;
        const oldComponentId = this.props.monitor.componentId;
        const newComponent = this.props.component;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-bottom--12"
            >
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Move Monitor to another Component
                                    </span>
                                </span>
                                <p>
                                    <span>
                                        Click this button to change the
                                        component this monitor belongs to.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        disabled={changingComponent}
                                        id={`change-component-${this.props.monitor.name}`}
                                        onClick={() => {
                                            this.props.openModal({
                                                id: changeMonitorComponentModalId,
                                                onClose: () => '',
                                                onConfirm: monitor =>
                                                    this.handleMonitorComponentChanged(
                                                        monitor,
                                                        oldComponentId,
                                                        newComponent
                                                    ),
                                                content: DataPathHoC(
                                                    ChangeMonitorComponent,
                                                    {
                                                        monitor: this.props
                                                            .monitor,
                                                    }
                                                ),
                                            });
                                        }}
                                    >
                                        <ShouldRender if={!changingComponent}>
                                            <span>Change Component</span>
                                        </ShouldRender>
                                        <ShouldRender if={changingComponent}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

MonitorViewChangeComponentBox.displayName = 'MonitorViewChangeComponentBox';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { openModal, closeModal, changeMonitorComponent },
        dispatch
    );

const mapStateToProps = (state, props) => {
    const currentComponentId = props.monitor.componentId;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(currentComponentId)) {
                component = c;
            }
        });
    });
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
        component,
    };
};

MonitorViewChangeComponentBox.propTypes = {
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    monitor: PropTypes.object.isRequired,
    changeMonitorComponent: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    component: PropTypes.object,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(MonitorViewChangeComponentBox)
);
