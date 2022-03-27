import React, { useEffect } from 'react';

import ClickOutside from 'react-click-outside';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { connect } from 'react-redux';

interface DeleteAutomatedScriptProps {
    confirmThisDialog: Function;
    closeThisDialog: Function;
    deleteScript: object;
}

const DeleteAutomatedScript = (props: DeleteAutomatedScriptProps) => {
    const { confirmThisDialog, closeThisDialog } = props;
    const handleKeyBoard = (e: $TSFixMe) => {
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

    const { requesting, error } = props.deleteScript;

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
                                <div
                                    className="bs-Modal-footer-actions"
                                    style={{ width: 280 }}
                                >
                                    <ShouldRender if={!requesting && error}>
                                        <div
                                            id="deleteError"
                                            className="bs-Tail-copy"
                                        >
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{
                                                    marginTop: '10px',
                                                    display: 'flex',
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{
                                                            color: 'red',
                                                        }}
                                                    >
                                                        {error}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                </div>
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
                                        {!requesting && (
                                            <>
                                                <span>Delete</span>
                                                <span className="delete-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </>
                                        )}
                                        {requesting && <FormLoader />}
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
    deleteScript: PropTypes.object.isRequired,
};

const mapStateToProps = (state: RootState) => {
    return {
        deleteScript: state.automatedScripts.deleteScript,
    };
};

export default connect(mapStateToProps, null)(DeleteAutomatedScript);
