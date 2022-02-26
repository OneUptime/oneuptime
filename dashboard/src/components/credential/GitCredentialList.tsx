import React, { useState, useEffect } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { deleteGitCredential } from '../../actions/credential';
import { openModal } from '../../actions/modal';
import { getGitSecurities } from '../../actions/credential';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { ListLoader } from '../basic/Loader';
import DeleteCredentialModal from './DeleteCredentialModal';
import GitCredentialModal from './GitCredentialModal';
import paginate from '../../utils/paginate';

const GitCredentialList = ({
    isRequesting,
    error,
    gitCredentials,
    projectId,
    deleteGitCredential,
    deleteError,
    openModal,
    getGitSecurities,
    modalId
}: $TSFixMe) => {
    const [page, setPage] = useState(1);

    const handleDelete = (credentialId: $TSFixMe) => {
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

    const handleCredentialUpdate = (credentialId: $TSFixMe) => {
        openModal({
            id: projectId,
            content: GitCredentialModal,
            propArr: [{ projectId, credentialId }],
        });
    };

    const handleKeyboard = (e: $TSFixMe) => {
        if (e.target.localName === 'body' && e.key) {
            switch (e.key) {
                case 'N':
                case 'n':
                    if (modalId !== projectId) {
                        e.preventDefault(); // prevent entering the key on the focused input element
                        return handleCredentialCreation();
                    }
                    return false;
                default:
                    return false;
            }
        }
    };

    useEffect(() => {
        window.addEventListener('keydown', handleKeyboard);
        return () => {
            window.removeEventListener('keydown', handleKeyboard);
        };
    });

    const prev = () => {
        setPage(page - 1);
    };
    const next = () => {
        setPage(page + 1);
    };

    const { next_page, pre_page, data, count } = paginate(
        gitCredentials.filter((obj: $TSFixMe) => obj.gitUsername),
        page,
        10
    );
    gitCredentials = data;
    const numberOfPages = Math.ceil(parseInt(count) / 10);

    return (
        <div className="Box-root  Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Git Credentials</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Here&#39;s a list of all the available git
                                    credentials for this project
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
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                            <span>Add Credential</span>
                                            <span className="new-btn__keycode">
                                                N
                                            </span>
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
                                    <div
                                        className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                        style={{
                                            float: 'right',
                                            paddingRight: '29px',
                                        }}
                                    >
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Action</span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>

                        <tbody className="Table-body">
                            {gitCredentials.map((gitCredential: $TSFixMe, index: $TSFixMe) => (
                                <tr
                                    key={gitCredential._id}
                                    className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                                >
                                    <td
                                        className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: '1px' }}
                                    >
                                        <div>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root">
                                                        <span
                                                            id={`gitUsername_${gitCredential.gitUsername}`}
                                                        >
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
                                        <div>
                                            <div
                                                className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                                style={{
                                                    paddingRight: '29px',
                                                }}
                                            >
                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root">
                                                        <button
                                                            id={`editCredentialBtn_${index}`}
                                                            title="delete"
                                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit Margin-left--8"
                                                            type="button"
                                                            onClick={() =>
                                                                handleCredentialUpdate(
                                                                    gitCredential._id
                                                                )
                                                            }
                                                        >
                                                            <span>Edit</span>
                                                        </button>
                                                        <button
                                                            id={`deleteCredentialBtn_${index}`}
                                                            title="delete"
                                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete Margin-left--8"
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
                        id="noGitCredential"
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
                </div>

                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div
                        className="bs-Tail-copy"
                        style={{
                            padding: '0 10px',
                        }}
                    >
                        <div
                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                            style={{
                                textAlign: 'center',
                                marginTop: '10px',
                                padding: '0 10px',
                            }}
                        >
                            <div className="Box-root">
                                <span className="Text-fontWeight--medium">
                                    {numberOfPages > 0
                                        ? `Page ${page} of ${numberOfPages} (${count} Git Credential${
                                              count === 1 ? '' : 's'
                                          })`
                                        : `${count} Git Credential${
                                              count < 2 ? '' : 's'
                                          }`}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
                                    className={`Button bs-ButtonLegacy ${!pre_page &&
                                        'Is--disabled'}`}
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'boolean |... Remove this comment to see the full error message
                                    disabled=""
                                    type="button"
                                    onClick={prev}
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Previous</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                            <div className="Box-root">
                                <button
                                    id="btnNext"
                                    className={`Button bs-ButtonLegacy ${!next_page &&
                                        'Is--disabled'}`}
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'boolean |... Remove this comment to see the full error message
                                    disabled=""
                                    type="button"
                                    onClick={next}
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Next</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
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
    deleteError: PropTypes.string,
    getGitSecurities: PropTypes.func,
    modalId: PropTypes.string,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { deleteGitCredential, openModal, getGitSecurities },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        deleteError: state.credential.deleteCredential.error,
        modalId: state.modal.modals[0] && state.modal.modals[0].id,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(GitCredentialList);
