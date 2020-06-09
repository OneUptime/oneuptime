import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';

class DeleteApplicationSecurity extends Component {
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        const {
            isRequesting,
            confirmThisDialog,
            closeThisDialog,
            deleteApplicationError,
        } = this.props;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            >
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
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
                                    application security ?
                                </span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div
                                    className="bs-Modal-footer-actions"
                                    style={{ width: 280 }}
                                >
                                    <ShouldRender
                                        if={
                                            !isRequesting &&
                                            deleteApplicationError
                                        }
                                    >
                                        <div
                                            id="deleteCardError"
                                            className="bs-Tail-copy"
                                        >
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        {deleteApplicationError}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                </div>
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        type="button"
                                        onClick={closeThisDialog}
                                        id="cancelApplicationSecurityModalBtn"
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        id="deleteApplicationSecurityModalBtn"
                                        className="bs-Button bs-DeprecatedButton bs-Button--red"
                                        type="button"
                                        onClick={confirmThisDialog}
                                        disabled={isRequesting}
                                    >
                                        {!isRequesting && <span>Delete</span>}
                                        {isRequesting && <FormLoader />}
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

DeleteApplicationSecurity.displayName = 'Delete Application Security';

DeleteApplicationSecurity.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    deleteApplicationError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapStateToProps = state => {
    return {
        isRequesting: state.security.deleteApplication.requesting,
        deleteApplicationError: state.security.deleteApplication.error,
    };
};

export default connect(mapStateToProps)(DeleteApplicationSecurity);
