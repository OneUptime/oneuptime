
import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from 'CommonUI/actions/modal';
import DeleteMonitor from '../modals/DeleteMonitor';
import { deleteMonitor } from '../../actions/monitor';
import { history, RootState } from '../../store';
import DataPathHoC from '../DataPathHoC';

interface MonitorViewDeleteBoxProps {
    currentProject: object;
    componentSlug: string;
    closeModal?: Function;
    openModal: Function;
    monitorState: object;
    monitor: object;
    deleteMonitor: Function;
}

export class MonitorViewDeleteBox extends Component<MonitorViewDeleteBoxProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { deleteModalId: uuidv4() };
    }

    deleteMonitor = () => {
        const projectId =

            this.props.monitor.projectId._id || this.props.monitor.projectId;

        const promise = this.props

            .deleteMonitor(this.props.monitor._id, projectId)
            .then(() => {
                history.push(

                    `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/monitoring`
                );
            });
        return promise; // onConfirm function is expecting a promise(async call).
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };

    override render() {
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
                                    <span>Delete Monitor</span>
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

                                        id={`delete_${this.props.monitor.name}`}
                                        onClick={() =>

                                            this.props.openModal({
                                                id: deleteModalId,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    // This awaits a promise after the delete request
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

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ openModal, closeModal, deleteMonitor }, dispatch);

const mapStateToProps: Function = (state: RootState) => {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
    };
};


MonitorViewDeleteBox.propTypes = {
    currentProject: PropTypes.object.isRequired,
    componentSlug: PropTypes.string.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    monitor: PropTypes.object.isRequired,
    deleteMonitor: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorViewDeleteBox);
