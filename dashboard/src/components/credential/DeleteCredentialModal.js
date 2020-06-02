import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader, LoadingState } from '../basic/Loader';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';

class DeleteCredentialModal extends Component {
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
            deleteCredentialError,
            propArr,
            securities,
            getSecurities,
            getSecuritiesError,
        } = this.props;

        const { credentialType, projectId } = propArr[0];
        const securityType =
            (credentialType === 'git' && 'application') ||
            (credentialType === 'docker' && 'container');

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            >
                <ShouldRender if={getSecurities}>
                    <div
                        className="ModalLayer-contents"
                        tabIndex={-1}
                        style={{ marginTop: 40, minWidth: 300 }}
                    >
                        <div className="bs-Modal-content Text-align--center">
                            <span className="Text-color--dark Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <LoadingState />
                            </span>
                        </div>
                    </div>
                </ShouldRender>

                <ShouldRender if={!getSecurities}>
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
                                            <span>Confirm Removal</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    {securities.length > 0 ? (
                                        <>
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                Please delete the following
                                                dependencies before you continue
                                            </span>
                                            {securities.map(security => (
                                                <span
                                                    style={{
                                                        display: 'block',
                                                        textDecoration:
                                                            'underline',
                                                    }}
                                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                >
                                                    <a
                                                        href={`/dashboard/project/${projectId}/${security.componentId._id}/security/${securityType}/${security._id}`}
                                                    >
                                                        {security.name}
                                                    </a>
                                                </span>
                                            ))}
                                        </>
                                    ) : (
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            Are you sure you want to remove this{' '}
                                            {credentialType} credential ?
                                        </span>
                                    )}
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{ width: 280 }}
                                    >
                                        <ShouldRender
                                            if={
                                                !isRequesting &&
                                                (deleteCredentialError ||
                                                    getSecuritiesError)
                                            }
                                        >
                                            <div
                                                id="deleteCardError"
                                                className="bs-Tail-copy"
                                            >
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
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
                                                            {deleteCredentialError ||
                                                                getSecuritiesError}
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
                                            id="cancelCredentialDeleteBtn"
                                            disabled={isRequesting}
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <ShouldRender if={securities.length === 0}>
                                            <button
                                                id="deleteCredentialBtn"
                                                className="bs-Button bs-DeprecatedButton bs-Button--red"
                                                type="button"
                                                onClick={confirmThisDialog}
                                                disabled={isRequesting}
                                            >
                                                {!isRequesting && (
                                                    <span>Remove</span>
                                                )}
                                                {isRequesting && <FormLoader />}
                                            </button>
                                        </ShouldRender>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
            </div>
        );
    }
}

DeleteCredentialModal.displayName = 'Delete Credential Modal';

DeleteCredentialModal.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    deleteCredentialError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    propArr: PropTypes.array.isRequired,
    getSecurities: PropTypes.bool,
    getSecuritiesError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    securities: PropTypes.array,
};

const mapStateToProps = (state, ownProps) => {
    const { propArr } = ownProps;
    const { credentialType } = propArr[0];

    const securities =
        (credentialType === 'git' && state.credential.gitSecurities) ||
        (credentialType === 'docker' && state.credential.dockerSecurities);

    return {
        isRequesting: state.credential.deleteCredential.requesting,
        deleteCredentialError: state.credential.deleteCredential.error,
        getSecurities: state.credential.getSecurities.requesting,
        getSecuritiesError: state.credential.getSecurities.error,
        securities,
    };
};

export default connect(mapStateToProps)(DeleteCredentialModal);
