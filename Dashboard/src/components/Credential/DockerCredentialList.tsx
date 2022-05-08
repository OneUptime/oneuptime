import React, { useState, useEffect } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { deleteDockerCredential } from '../../actions/credential';
import { openModal } from 'CommonUI/actions/Modal';
import { getDockerSecurities } from '../../actions/credential';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { ListLoader } from '../basic/Loader';
import DeleteCredentialModal from './DeleteCredentialModal';
import DockerCredentialModal from './DockerCredentialModal';
import paginate from '../../utils/paginate';

interface DockerCredentialListProps {
    error?: string;
    isRequesting: boolean;
    dockerCredentials?: unknown[];
    deleteError?: string;
    projectId?: string;
    openModal?: Function;
    deleteDockerCredential?: Function;
    getDockerSecurities?: Function;
    modalId?: string;
}

const DockerCredentialList: Function = ({
    isRequesting,
    error,
    dockerCredentials,
    deleteDockerCredential,
    projectId,
    deleteError,
    openModal,
    getDockerSecurities,
    modalId
}: DockerCredentialListProps) => {
    const [page, setPage]: $TSFixMe = useState(1);

    const handleDelete: Function = (credentialId: $TSFixMe) => {
        getDockerSecurities({ projectId, credentialId });

        openModal({
            id: projectId,
            onConfirm: () => {
                return deleteDockerCredential({
                    projectId,
                    credentialId,
                }).then(() => {
                    if (deleteError) {
                        return handleDelete(credentialId);
                    }
                });
            },
            content: DeleteCredentialModal,
            propArr: [{ credentialType: 'docker', projectId }],
        });
    };

    const handleCredentialCreation: Function = () => {
        openModal({
            id: projectId,
            content: DockerCredentialModal,
            propArr: [{ projectId }],
        });
    };

    const handleCredentialUpdate: Function = (credentialId: $TSFixMe) => {
        openModal({
            id: projectId,
            content: DockerCredentialModal,
            propArr: [{ projectId, credentialId }],
        });
    };

    const handleKeyboard: Function = (e: $TSFixMe) => {
        if (e.target.localName === 'body' && e.key) {
            switch (e.key) {
                case 'N':
                case 'n':
                    if (modalId !== projectId) {
                        e.preventDefault(); // prevent entering the key in the focused input field
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

    const prev: Function = () => setPage(page - 1);
    const next: Function = () => setPage(page + 1);
    const { next_page, pre_page, data, count }: $TSFixMe = paginate(
        dockerCredentials,
        page,
        10
    );

    dockerCredentials = data;
    const numberOfPages: $TSFixMe = Math.ceil(parseInt(count) / 10);

    return (
        <div className="Box-root  Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Docker Credentials</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Here&#39;s a list of all the available
                                    docker credentials for this project
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <button
                                    id="addCredentialBtn"
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    type="button"
                                    onClick={handleCredentialCreation}
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
                                            <span>Docker Registry URL</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Docker Username</span>
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
                            {dockerCredentials.map(
                                (dockerCredential: $TSFixMe, index: $TSFixMe) => (
                                    <tr
                                        key={dockerCredential._id}
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
                                                            <span>
                                                                {
                                                                    dockerCredential.dockerRegistryUrl
                                                                }
                                                            </span>
                                                        </div>
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div>
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root">
                                                            <span
                                                                id={`dockerUsername_${dockerCredential.dockerUsername}`}
                                                            >
                                                                {
                                                                    dockerCredential.dockerUsername
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
                                                                        dockerCredential._id
                                                                    )
                                                                }
                                                            >
                                                                <span>
                                                                    Edit
                                                                </span>
                                                            </button>
                                                            <button
                                                                id={`deleteCredentialBtn_${index}`}
                                                                title="delete"
                                                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete Margin-left--8"
                                                                type="button"
                                                                onClick={() =>
                                                                    handleDelete(
                                                                        dockerCredential._id
                                                                    )
                                                                }
                                                            >
                                                                <span>
                                                                    Remove
                                                                </span>
                                                            </button>
                                                        </div>
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            )}
                        </tbody>
                    </table>
                </div>
                <ShouldRender
                    if={!isRequesting && dockerCredentials.length === 0}
                >
                    <div
                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                        style={{
                            textAlign: 'center',
                            marginTop: '20px',
                            padding: '0 10px',
                        }}
                        id="noDockerCredential"
                    >
                        There are no docker credentials for this project
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
                                        ? `Page ${page} of ${numberOfPages} (${count} Docker Credential${count === 1 ? '' : 's'
                                        })`
                                        : `${count} Docker Credential${count === 1 ? '' : 's'
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

DockerCredentialList.displayName = 'DockerCredentialList';

DockerCredentialList.propTypes = {
    error: PropTypes.string,
    isRequesting: PropTypes.bool.isRequired,
    dockerCredentials: PropTypes.array,
    deleteError: PropTypes.string,
    projectId: PropTypes.string,
    openModal: PropTypes.func,
    deleteDockerCredential: PropTypes.func,
    getDockerSecurities: PropTypes.func,
    modalId: PropTypes.string,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    { deleteDockerCredential, openModal, getDockerSecurities },
    dispatch
);

const mapStateToProps: Function = (state: RootState) => {
    return {
        deleteError: state.credential.deleteCredential.error,
        modalId: state.modal.modals[0] && state.modal.modals[0].id,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DockerCredentialList);
