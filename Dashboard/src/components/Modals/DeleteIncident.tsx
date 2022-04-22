import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from 'CommonUI/actions/modal';
import { deleteIncident } from '../../actions/incident';

import { history, RootState } from '../../store';

interface DeleteIncidentProps {
    data: object;
    closeModal?: Function;
    deleteIncident?: Function;
    deleting?: boolean;
}

class DeleteIncident extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal();
            case 'Enter':
                return this.deleteIncident();
            default:
                return false;
        }
    };

    deleteIncident = () => {
        const {
            projectId,
            incidentId,
            componentSlug,
            currentProjectSlug,
            monitors,

        } = this.props.data;


        const promise: $TSFixMe = this.props.deleteIncident(projectId, incidentId);
        promise.then(() => {

            this.props.closeModal();

            if (componentSlug) {
                if (monitors.length > 1) {
                    history.push(
                        `/dashboard/project/${currentProjectSlug}/component/${componentSlug}/monitoring`
                    );
                } else {
                    history.push(
                        `/dashboard/project/${currentProjectSlug}/component/${componentSlug}/monitoring/${monitors[0].monitorId.slug}`
                    );
                }
            } else {
                history.push(
                    '/dashboard/project/' + currentProjectSlug + '/incidents'
                );
            }
        });
        return promise;
    };

    override render() {

        const { deleting, closeModal }: $TSFixMe = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeModal}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Deletion</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to delete this
                                        incident?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={closeModal}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <ShouldRender if={!deleting}>
                                            <button
                                                id="confirmDeleteIncident"
                                                className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                                type="button"
                                                onClick={this.deleteIncident}
                                                autoFocus={true}
                                            >
                                                <span>Delete</span>
                                                <span className="delete-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </button>
                                        </ShouldRender>
                                        <ShouldRender if={deleting}>
                                            <button
                                                className="bs-Button bs-DeprecatedButton bs-Button--red"
                                                type="button"
                                            >
                                                <FormLoader />
                                            </button>
                                        </ShouldRender>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


DeleteIncident.displayName = 'DeleteIncidentFormModal';


DeleteIncident.propTypes = {
    data: PropTypes.object.isRequired,
    closeModal: PropTypes.func,
    deleteIncident: PropTypes.func,
    deleting: PropTypes.bool,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        deleting: state.incident.incident.deleteIncident
            ? state.incident.incident.deleteIncident.requesting
            : false,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ closeModal, deleteIncident }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(DeleteIncident);
