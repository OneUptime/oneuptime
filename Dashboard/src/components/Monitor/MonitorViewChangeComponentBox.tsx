
import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators, compose } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from 'common-ui/actions/modal';
import { changeMonitorComponent } from '../../actions/monitor';
import { addCurrentComponent } from '../../actions/component';
import DataPathHoC from '../DataPathHoC';
import ChangeMonitorComponent from '../modals/ChangeMonitorComponent';

interface MonitorViewChangeComponentBoxProps {
    closeModal?: Function;
    openModal: Function;
    monitorState: object;
    monitor: object;
    changeMonitorComponent: Function;
    component?: object;
}

class MonitorViewChangeComponentBox extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            changeMonitorComponentModalId: uuidv4(),
        };
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({

                    id: this.state.changeMonitorComponentModalId,
                });
            default:
                return false;
        }
    };

    override render() {
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
                                                content: DataPathHoC(
                                                    ChangeMonitorComponent,
                                                    {
                                                        monitor: this.props

                                                            .monitor,
                                                        oldComponentId,
                                                        newComponent,
                                                        component: this.props

                                                            .component,
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

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    { openModal, closeModal, changeMonitorComponent, addCurrentComponent },
    dispatch
);

const mapStateToProps = (state: RootState, props: $TSFixMe) => {
    const { componentSlug } = props.match.params;
    let component;
    state.component.componentList.components.forEach((item: $TSFixMe) => {
        item.components.forEach((c: $TSFixMe) => {
            if (String(c.slug) === String(componentSlug)) {
                component = c;
            }
        });
    });
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
        component,
        componentSlug,
    };
};


MonitorViewChangeComponentBox.propTypes = {
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    monitor: PropTypes.object.isRequired,
    changeMonitorComponent: PropTypes.func.isRequired,
    component: PropTypes.object,
};

export default compose(
    withRouter,
    connect(mapStateToProps, mapDispatchToProps)
)(MonitorViewChangeComponentBox);
