import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import uuid from 'uuid';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { openModal, closeModal } from '../../actions/modal';
import { deleteApplicationLog } from '../../actions/applicationLog';
import { history } from '../../store';
import DataPathHoC from '../DataPathHoC';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import DeleteApplicationLog from '../modals/DeleteApplicationLog';
import ShouldRender from '../basic/ShouldRender';

class ApplicationLogViewDeleteBox extends Component {
    constructor(props) {
        super(props);
        this.state = { deleteModalId: uuid.v4() };
    }
    deleteApplicationLog = () => {
        const componentId = this.props.applicationLog[0].componentId._id;
        const currentProjectId = this.props.currentProject._id;
        const promise = this.props.deleteApplicationLog(
            currentProjectId,
            componentId,
            this.props.applicationLog[0]._id
        );
        history.push(
            `/dashboard/project/${this.props.currentProject._id}/${this.props.componentId}/application-log`
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > APPLICATION LOG > APPLICATION LOG DELETED',
                {
                    ProjectId: this.props.currentProject._id,
                    applicationLogId: this.props.applicationLog[0]._id,
                }
            );
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
            this.props &&
            this.props.applicationLogState &&
            this.props.applicationLogState.deleteApplicationLog &&
            this.props.applicationLogState.deleteApplicationLog ===
                this.props.data.applicationLog._id
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
                                    <span>Delete This Application Log</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanantly delete
                                        this application log.
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
                                                    this.deleteApplicationLog(),
                                                content: DataPathHoC(
                                                    DeleteApplicationLog,
                                                    {
                                                        applicationLog: this
                                                            .props
                                                            .applicationLog[0],
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
ApplicationLogViewDeleteBox.displayName = 'ApplicationLogViewDeleteBox';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { openModal, closeModal, deleteApplicationLog },
        dispatch
    );

const mapStateToProps = state => {
    return {
        applicationLogState: state.applicationLog,
        currentProject: state.project.currentProject,
    };
};

ApplicationLogViewDeleteBox.propTypes = {
    currentProject: PropTypes.object,
    componentId: PropTypes.string.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    applicationLogState: PropTypes.object.isRequired,
    applicationLog: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    deleteApplicationLog: PropTypes.func.isRequired,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ApplicationLogViewDeleteBox)
);
