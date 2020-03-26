import uuid from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import DeleteMonitor from '../modals/DeleteMonitor';
import { deleteMonitor } from '../../actions/monitor';
import { history } from '../../store';
import DataPathHoC from '../DataPathHoC';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

export class MonitorViewDeleteBox extends Component {
    constructor(props) {
        super(props);
        this.state = { deleteModalId: uuid.v4() };
    }

    deleteMonitor = () => {
        const projectId =
            this.props.monitor.projectId._id || this.props.monitor.projectId;
        const promise = this.props.deleteMonitor(
            this.props.monitor._id,
            projectId
        );
        history.push(
            `/dashboard/project/${this.props.currentProject._id}/${this.props.componentId}/monitoring`
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Monitor Deleted', {
                ProjectId: this.props.currentProject._id,
                monitorId: this.props.monitor._id,
            });
        }
        return promise;
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };

    render() {
        let deleting = false;
        if (
            this.props.monitorState &&
            this.props.monitorState.deleteMonitor &&
            this.props.monitorState.deleteMonitor === this.props.monitor._id
        ) {
            deleting = true;
        }
        const { deleteModalId } = this.state;

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
                                    <span>Delete This Monitor</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanantly delete
                                        this monitor.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--red Box-background--red"
                                        disabled={deleting}
                                        onClick={() =>
                                            this.props.openModal({
                                                id: deleteModalId,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    this.deleteMonitor(),
                                                content: DataPathHoC(
                                                    DeleteMonitor,
                                                    {
                                                        monitor: this.props
                                                            .monitor,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <ShouldRender if={!deleting}>
                                            <span>Delete</span>
                                        </ShouldRender>
                                        <ShouldRender if={deleting}>
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

MonitorViewDeleteBox.displayName = 'MonitorViewDeleteBox';

const mapDispatchToProps = dispatch =>
    bindActionCreators({ openModal, closeModal, deleteMonitor }, dispatch);

const mapStateToProps = state => {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
    };
};

MonitorViewDeleteBox.propTypes = {
    currentProject: PropTypes.object.isRequired,
    componentId: PropTypes.object.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    monitor: PropTypes.object.isRequired,
    deleteMonitor: PropTypes.func.isRequired,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(MonitorViewDeleteBox)
);
