import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { deleteGitCredential } from '../../actions/credential';
import { openModal, closeModal } from '../../actions/modal';
import { getGitSecurities } from '../../actions/credential';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { ListLoader } from '../basic/Loader';
import DeleteCredentialModal from './DeleteCredentialModal';
import GitCredentialModal from './GitCredentialModal';

const GitCredentialList = ({
    isRequesting,
    error,
    gitCredentials,
    projectId,
    deleteGitCredential,
    deleteError,
    openModal,
    closeModal,
    getGitSecurities,
}) => {
    const handleDelete = credentialId => {
        getGitSecurities({ projectId, credentialId });

        openModal({
            id: projectId,
            onConfirm: () => {
                return deleteGitCredential({
                    projectId,
                    credentialId,
                }).then(() => {
                    if (deleteError) {
                        return handleDelete(credentialId);
                    }
                });
            },
            content: DeleteCredentialModal,
            propArr: [{ credentialType: 'git', projectId }],
        });
    };

    const handleCredentialCreation = () => {
        openModal({
            id: projectId,
            content: GitCredentialModal,
            propArr: [{ projectId }],
        });
    };

    const handleKeyboard = e => {
        switch (e.key) {
            case 'Escape':
                return closeModal({ id: projectId });
            default:
                return false;
        }
    };

    return (
        <div onKeyDown={handleKeyboard} className="Box-root  Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span style={{ textTransform: 'capitalize' }}>
                                    Git Credentials
                                </span>
                            </span>
                            <span
                                style={{ textTransform: 'lowercase' }}
                                className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                            >
                                <span>
                                    Here&#39;s a list of all the available Git
                                    Credentials for this project
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <button
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    type="button"
                                    onClick={handleCredentialCreation}
                                    id="addCredentialBtn"
                                >
                                    <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <div className="Box-root Margin-right--8">
                                            <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                        </div>
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>Add Credential</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Git Username</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span></span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>

                        <tbody className="Table-body">
                            {gitCredentials.map((gitCredential, index) => (
                                <tr
                                    key={gitCredential._id}
                                    className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                                >
                                    <td
                                        className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: '1px' }}
                                    >
                                        <div className="db-ListViewItem-link">
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root">
                                                        <span>
                                                            {
                                                                gitCredential.gitUsername
                                                            }
                                                        </span>
                                                    </div>
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            textAlign: 'right',
                                        }}
                                    >
                                        <div className="db-ListViewItem-link">
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root">
                                                        <button
                                                            id={`deleteCredentialBtn_${index}`}
                                                            title="delete"
                                                            className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                            type="button"
                                                            onClick={() =>
                                                                handleDelete(
                                                                    gitCredential._id
                                                                )
                                                            }
                                                        >
                                                            <span>Remove</span>
                                                        </button>
                                                    </div>
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <ShouldRender if={!isRequesting && gitCredentials.length === 0}>
                    <div
                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                        style={{
                            textAlign: 'center',
                            marginTop: '20px',
                            padding: '0 10px',
                        }}
                    >
                        There are no git credentials for this project
                    </div>
                </ShouldRender>

                <ShouldRender if={isRequesting}>
                    <ListLoader />
                </ShouldRender>

                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <ShouldRender if={error}>
                        <div
                            className="bs-Tail-copy"
                            style={{ padding: '10px' }}
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                style={{
                                    textAlign: 'center',
                                    marginTop: '10px',
                                    padding: '0 10px',
                                }}
                            >
                                <div className="Box-root Margin-right--8">
                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                </div>
                                <div className="Box-root">
                                    <span style={{ color: 'red' }}>
                                        {error}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </ShouldRender>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

GitCredentialList.displayName = 'GitCredentialList';

GitCredentialList.propTypes = {
    error: PropTypes.string,
    isRequesting: PropTypes.bool.isRequired,
    gitCredentials: PropTypes.array,
    projectId: PropTypes.string,
    deleteGitCredential: PropTypes.func,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    deleteError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    getGitSecurities: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { deleteGitCredential, openModal, closeModal, getGitSecurities },
        dispatch
    );

const mapStateToProps = state => {
    return {
        deleteError: state.credential.deleteCredential.error,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(GitCredentialList);
