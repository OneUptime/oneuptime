import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';

interface DeleteErrorTrackerProps {
    confirmThisDialog: Function;
    closeThisDialog: Function;
    errorTrackerState?: object;
    data?: object;
}

class DeleteErrorTracker extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':

                return this.props.confirmThisDialog();
            default:
                return false;
        }
    };

    override render() {

        const { closeThisDialog }: $TSFixMe = this.props;
        let deleting = false;
        if (

            this.props.errorTrackerState &&

            this.props.errorTrackerState.deleteErrorTracker &&

            this.props.errorTrackerState.deleteErrorTracker ===

            this.props.data.errorTracker._id
        ) {
            deleting = true;
        }

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
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
                                        error tracker ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"

                                            onClick={this.props.closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteErrorTracker"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={

                                                this.props.confirmThisDialog
                                            }
                                            disabled={deleting}
                                            autoFocus={true}
                                        >
                                            {!deleting && (
                                                <>
                                                    <span>Delete</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {deleting && <FormLoader />}
                                        </button>
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


DeleteErrorTracker.displayName = 'DeleteErrorTrackerFormModal';


DeleteErrorTracker.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    errorTrackerState: PropTypes.object,
    data: PropTypes.object,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        errorTrackerState: state.errorTracker,
    };
};

export default connect(mapStateToProps)(DeleteErrorTracker);
