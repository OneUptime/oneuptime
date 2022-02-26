import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import PropTypes from 'prop-types';
import { openModal, closeModal } from '../../actions/modal';
import { deleteApplicationLog } from '../../actions/applicationLog';
import { history } from '../../store';
import DataPathHoC from '../DataPathHoC';

import DeleteApplicationLog from '../modals/DeleteApplicationLog';

class ApplicationLogViewDeleteBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { deleteModalId: uuidv4() };
    }
    deleteApplicationLog = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
        const applicationLog = this.props.applicationLog;
        const componentId = applicationLog.componentId._id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const currentProjectId = this.props.currentProject._id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteApplicationLog' does not exist on ... Remove this comment to see the full error message
        const promise = this.props.deleteApplicationLog(
            currentProjectId,
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            this.props.applicationLog._id
        );
        history.push(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/application-log`
        );

        return promise;
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteModalId' does not exist on type 'R... Remove this comment to see the full error message
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
                                    <span>Delete Log Container</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanantly delete
                                        this log container.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--red Box-background--red"
                                        onClick={() =>
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
                                                            .applicationLog,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <span>Delete</span>
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
ApplicationLogViewDeleteBox.displayName = 'ApplicationLogViewDeleteBox';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { openModal, closeModal, deleteApplicationLog },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        applicationLogState: state.applicationLog,
        currentProject: state.project.currentProject,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ApplicationLogViewDeleteBox.propTypes = {
    currentProject: PropTypes.object,
    componentId: PropTypes.string.isRequired,
    componentSlug: PropTypes.string.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    applicationLog: PropTypes.object,
    deleteApplicationLog: PropTypes.func.isRequired,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ApplicationLogViewDeleteBox)
);
