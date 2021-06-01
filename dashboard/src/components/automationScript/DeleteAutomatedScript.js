import React, { useEffect } from 'react';
import ClickOutside from 'react-click-outside';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';

const DeleteAutomatedScript = props => {
    const { confirmThisDialog, closeThisDialog, data } = props;
    const handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return closeThisDialog();
            case 'Enter':
                return confirmThisDialog();
            default:
                return false;
        }
    };

    useEffect(() => {
        window.addEventListener('keydown', handleKeyBoard);
    }, []);

    console.log(data, 'overflow');

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
                                    Are you sure you want to delete this script
                                    ?
                                </span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                        type="button"
                                        onClick={closeThisDialog}
                                    >
                                        <span>Cancel</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                    <button
                                        id="deleteMonitor"
                                        className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                        type="button"
                                        onClick={confirmThisDialog}
                                        disabled={false}
                                        autoFocus={true}
                                    >
                                        {true && (
                                            <>
                                                <span>Delete</span>
                                                <span className="delete-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </>
                                        )}
                                        {false && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        </div>
    );
};

DeleteAutomatedScript.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object,
};

export default DeleteAutomatedScript;
