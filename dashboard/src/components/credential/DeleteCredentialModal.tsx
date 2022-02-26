import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader, LoadingState } from '../basic/Loader';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';

class DeleteCredentialModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            case 'Enter':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmThisDialog' does not exist on typ... Remove this comment to see the full error message
                return this.props.confirmThisDialog();
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmThisDialog' does not exist on typ... Remove this comment to see the full error message
            confirmThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteCredentialError' does not exist on... Remove this comment to see the full error message
            deleteCredentialError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'propArr' does not exist on type 'Readonl... Remove this comment to see the full error message
            propArr,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'securities' does not exist on type 'Read... Remove this comment to see the full error message
            securities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getSecurities' does not exist on type 'R... Remove this comment to see the full error message
            getSecurities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getSecuritiesError' does not exist on ty... Remove this comment to see the full error message
            getSecuritiesError,
        } = this.props;
        const { credentialType, ssh } = propArr[0];
        const securityType =
            (credentialType === 'git' && 'application') ||
            (credentialType === 'docker' && 'container');

        return (
            <div
                id="deleteCredentialModal"
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            >
                <ShouldRender if={getSecurities}>
                    <div
                        className="ModalLayer-contents"
                        tabIndex={-1}
                        style={{ marginTop: 40, width: 300 }}
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
                                <ClickOutside onClickOutside={closeThisDialog}>
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
                                                    dependencies before you
                                                    continue
                                                </span>
                                                {securities.map((security: $TSFixMe) => <span
                                                    key={security._id}
                                                    style={{
                                                        display: 'block',
                                                        textDecoration:
                                                            'underline',
                                                    }}
                                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                >
                                                    <a
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        href={`/dashboard/project/${this.props.slug}/component/${security.componentId.slug}/security/${securityType}/${security._id}`}
                                                    >
                                                        {security.name}
                                                    </a>
                                                </span>)}
                                            </>
                                        ) : (
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                Are you sure you want to remove
                                                this {credentialType}{' '}
                                                {ssh ? 'ssh' : 'credential'}?
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
                                                                    color:
                                                                        'red',
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
                                                className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                                type="button"
                                                onClick={closeThisDialog}
                                                id="cancelCredentialDeleteBtn"
                                                disabled={isRequesting}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <ShouldRender
                                                if={securities.length === 0}
                                            >
                                                <button
                                                    id="deleteCredentialBtn"
                                                    className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                                    type="button"
                                                    onClick={confirmThisDialog}
                                                    disabled={isRequesting}
                                                    autoFocus={true}
                                                >
                                                    {!isRequesting && (
                                                        <>
                                                            <span>Remove</span>
                                                            <span className="delete-btn__keycode">
                                                                <span className="keycode__icon keycode__icon--enter" />
                                                            </span>
                                                        </>
                                                    )}
                                                    {isRequesting && (
                                                        <FormLoader />
                                                    )}
                                                </button>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                </ClickOutside>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DeleteCredentialModal.displayName = 'Delete Credential Modal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DeleteCredentialModal.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    deleteCredentialError: PropTypes.string,
    propArr: PropTypes.array.isRequired,
    getSecurities: PropTypes.bool,
    getSecuritiesError: PropTypes.string,
    securities: PropTypes.array,
    slug: PropTypes.string,
};

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { propArr } = ownProps;
    const { credentialType } = propArr[0];

    const securities =
        (credentialType === 'git' && state.credential.gitSecurities) ||
        (credentialType === 'docker' && state.credential.dockerSecurities);

    return {
        isRequesting: state.credential.deleteCredential.requesting,
        deleteCredentialError: state.credential.deleteCredential.error,
        getSecurities: state.credential.getSecurities.requesting,
        slug: state.project.currentProject && state.project.currentProject.slug,
        getSecuritiesError: state.credential.getSecurities.error,
        securities,
    };
};

export default connect(mapStateToProps)(DeleteCredentialModal);
