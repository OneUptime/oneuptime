// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators, compose } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import { changeMonitorComponent } from '../../actions/monitor';
import { addCurrentComponent } from '../../actions/component';
import DataPathHoC from '../DataPathHoC';
import ChangeMonitorComponent from '../modals/ChangeMonitorComponent';

class MonitorViewChangeComponentBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            changeMonitorComponentModalId: uuidv4(),
        };
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'changeMonitorComponentModalId' does not ... Remove this comment to see the full error message
                    id: this.state.changeMonitorComponentModalId,
                });
            default:
                return false;
        }
    };

    render() {
        let changingComponent = false;
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.monitorState &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.monitorState.changeMonitorComponent &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.monitorState.changeMonitorComponent ===
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                this.props.monitor._id
        ) {
            changingComponent = true;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'changeMonitorComponentModalId' does not ... Remove this comment to see the full error message
        const { changeMonitorComponentModalId } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
        const oldComponentId = this.props.monitor.componentId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                        id={`change-component-${this.props.monitor.name}`}
                                        onClick={() => {
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                            this.props.openModal({
                                                id: changeMonitorComponentModalId,
                                                onClose: () => '',
                                                content: DataPathHoC(
                                                    ChangeMonitorComponent,
                                                    {
                                                        monitor: this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                            .monitor,
                                                        oldComponentId,
                                                        newComponent,
                                                        component: this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MonitorViewChangeComponentBox.displayName = 'MonitorViewChangeComponentBox';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { openModal, closeModal, changeMonitorComponent, addCurrentComponent },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
