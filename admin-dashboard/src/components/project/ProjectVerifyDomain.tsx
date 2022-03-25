import React, { Component } from 'react';
import { connect } from 'react-redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'common-ui/actions/modal';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';
import {
    fetchProjectDomains,
    verifyProjectDomain,
    resetVerifyProjectDomain,
} from '../../actions/project';

class ProjectVerifyDomain extends Component<ComponentProps> {

    public static propTypes = {};

    override componentDidMount() {

        this.props.resetVerifyProjectDomain();
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return this.handleVerifyDomain();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.domainId,
        });
    };

    handleVerifyDomain = () => {
        const {

            domainId,

            projectId,

            verifyProjectDomain,

            fetchProjectDomains,
        } = this.props;
        verifyProjectDomain({ projectId, domainId }).then(() => {

            if (!this.props.verifyError) {
                fetchProjectDomains(projectId, 0, 10);
                this.handleCloseModal();
            }
        });
    };

    override render() {

        const { requesting, verificationToken, verifyError } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div
                            className="bs-Modal bs-Modal--large"
                            style={{ maxWidth: 'none' }}
                        >
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Verify Domain</span>
                                        </span>
                                    </div>
                                    <div className="bs-Modal-header-copy Margin-top--8">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            Add this record to your domain by
                                            visiting your DNS provider or
                                            registrar. For help on how you can
                                            add txt records, follow this{' '}
                                            <a
                                                href="https://github.com/OneUptime/feature-docs/blob/master/txt-records.md"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="Text-fontWeight--medium"
                                            >
                                                link
                                            </a>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                    <div>
                                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                            <table className="Table">
                                                <thead className="Table-body">
                                                    <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                                        <td
                                                            style={{
                                                                width: '30%',
                                                            }}
                                                        >
                                                            <div className="bs-ObjectList-cell">
                                                                Record type
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <div className="bs-ObjectList-cell">
                                                                Host
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <div className="bs-ObjectList-cell">
                                                                Value
                                                            </div>
                                                        </td>
                                                    </tr>
                                                </thead>
                                                <tbody className="Table-body">
                                                    <tr className="Table-row db-ListViewItem bs-ActionsParent">
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Margin-right--16">
                                                                        <span>
                                                                            TXT
                                                                        </span>
                                                                    </div>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Margin-right--16">
                                                                        <span>
                                                                            oneuptime
                                                                        </span>
                                                                    </div>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Margin-right--16">
                                                                        <span>
                                                                            {
                                                                                verificationToken
                                                                            }
                                                                        </span>
                                                                    </div>
                                                                </span>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="Flex-flex Flex-direction--row bs-u-justify--between"
                                        style={{ width: '100%' }}
                                    >
                                        <div>
                                            <ShouldRender
                                                if={!requesting && verifyError}
                                            >
                                                <div
                                                    id="verifyDomainError"
                                                    className="bs-Tail-copy Flex-flex--3"
                                                >
                                                    <div
                                                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                        style={{
                                                            marginTop: '10px',
                                                        }}
                                                    >
                                                        <div className="Box-root Margin-right--8">
                                                            <div
                                                                className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                                                style={{
                                                                    marginTop:
                                                                        '2px',
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="Box-root">
                                                            <span
                                                                style={{
                                                                    color:
                                                                        'red',
                                                                }}
                                                            >
                                                                {verifyError}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                        </div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignSelf: 'flex-start',
                                            }}
                                            className="Margin-top--8 bs-u-self--end Text-align--right"
                                        >
                                            <button
                                                id="cancelVerifyDomain"
                                                className={`bs-Button btn__modal ${requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                disabled={requesting}
                                                onClick={this.handleCloseModal}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="confirmVerifyDomain"
                                                className={`bs-Button bs-Button--blue btn__modal ${requesting &&
                                                    'bs-is-disabled'}`}
                                                onClick={
                                                    this.handleVerifyDomain
                                                }
                                                disabled={requesting}
                                                autoFocus={true}
                                            >
                                                {!requesting && (
                                                    <>
                                                        <span>Verify</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}

                                                {requesting && <FormLoader />}
                                            </button>
                                        </div>
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

const mapStateToProps = (state: $TSFixMe) => ({
    requesting: state.project.verifyDomain.requesting,
    verifyError: state.project.verifyDomain.error,
    domainId: state.modal.modals[0].id,
    verificationToken: state.modal.modals[0].verificationToken,
    domain: state.modal.modals[0].domain,
    projectId: state.modal.modals[0].projectId
});


ProjectVerifyDomain.displayName = 'ProjectVerifyDomain';

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
        fetchProjectDomains,
        verifyProjectDomain,
        resetVerifyProjectDomain,
    },
    dispatch
);


ProjectVerifyDomain.propTypes = {
    closeModal: PropTypes.func,
    domainId: PropTypes.string,
    requesting: PropTypes.bool,
    verificationToken: PropTypes.string,
    verifyError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    projectId: PropTypes.string,
    fetchProjectDomains: PropTypes.func,
    verifyProjectDomain: PropTypes.func,
    resetVerifyProjectDomain: PropTypes.func,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ProjectVerifyDomain);
