// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import DisableMonitor from '../modals/DisableMonitor';
import { disableMonitor } from '../../actions/monitor';
import DataPathHoC from '../DataPathHoC';

export class MonitorViewDisableBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { disableModalId: uuidv4() };
    }

    disableMonitor = async () => {
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.projectId._id || this.props.monitor.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'disableMonitor' does not exist on type '... Remove this comment to see the full error message
        const promise = await this.props.disableMonitor(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor._id,
            projectId
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tabSelected' does not exist on type 'Rea... Remove this comment to see the full error message
        this.props.tabSelected(0);

        return promise;
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({ id: this.state.disableModalId });
            default:
                return false;
        }
    };

    render() {
        let disabling = false;
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.monitorState &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.monitorState.disableMonitor &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.monitorState.disableMonitor === this.props.monitor._id
        ) {
            disabling = true;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'disableModalId' does not exist on type '... Remove this comment to see the full error message
        const { disableModalId } = this.state;
        const disabledMonitor =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor && this.props.monitor.disabled;
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
                                        {disabledMonitor
                                            ? 'Enable Monitor'
                                            : 'Disable Monitor'}
                                    </span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to{' '}
                                        {disabledMonitor ? 'enable' : 'disable'}{' '}
                                        this monitor.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        disabled={disabling}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                        id={`disable_${this.props.monitor.name}`}
                                        onClick={() =>
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                            this.props.openModal({
                                                id: disableModalId,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    this.disableMonitor(),
                                                content: DataPathHoC(
                                                    DisableMonitor,
                                                    {
                                                        monitor: this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                            .monitor,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <ShouldRender if={!disabling}>
                                            <span>
                                                {disabledMonitor
                                                    ? 'Enable'
                                                    : 'Disable'}
                                            </span>
                                        </ShouldRender>
                                        <ShouldRender if={disabling}>
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
MonitorViewDisableBox.displayName = 'MonitorViewDisableBox';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ openModal, closeModal, disableMonitor }, dispatch);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
MonitorViewDisableBox.propTypes = {
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    monitor: PropTypes.object.isRequired,
    disableMonitor: PropTypes.func.isRequired,
    tabSelected: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorViewDisableBox);
