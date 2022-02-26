import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { ListLoader } from '../basic/Loader.js';
import ShouldRender from '../basic/ShouldRender';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { generateBackupCodes } from '../../actions/profile.js';

class BackupCodesModal extends React.Component {
    state = {
        copied: false,
        codes: null,
        close: false,
    };

    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            profileSettings: { data },
        } = this.props;
        if (data.backupCodes && data.backupCodes.length > 0) {
            const codes = data.backupCodes.map((code: $TSFixMe) => code.code);
            this.setState({ codes });
        }
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    copyCodesHandler = () => {
        this.setState({ copied: true });
        setTimeout(() => {
            this.setState({ close: true });
        }, 2000);
    };

    refineCodes = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            profileSettings: { data },
        } = this.props;
        const refinedCodes = [];
        if (data.backupCodes.length > 0) {
            const rows = Math.ceil(data.backupCodes.length / 2);
            let j = 0;
            for (let i = 0; i < rows; i++) {
                const temp = [data.backupCodes[j], data.backupCodes[j + 1]];
                j += 2;
                refinedCodes.push(temp);
            }
        }
        return refinedCodes;
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'generateBackupCodes' does not exist on t... Remove this comment to see the full error message
        const { generateBackupCodes } = this.props;
        const backupCodes = this.refineCodes();

        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                <ClickOutside onClickOutside={this.props.closeThisDialog}>
                    <div className="bs-BIM">
                        <div className="bs-Modal">
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '5px',
                                        marginTop: '5px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <div>
                                            Two Factor Authentication Backup
                                            Codes
                                        </div>
                                    </span>
                                </div>
                            </div>
                            <div className="Padding-horizontal--2">
                                <div className="bs-Modal-block">
                                    <div>
                                        <div className="bs-Fieldset-wrapper">
                                            <div className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--normal Text-lineHeight--24 Text-typeface--base Text-wrap--wrap Padding-bottom--48">
                                                You have to print these codes or
                                                keep them in the safe place.
                                            </div>
                                            <fieldset
                                                style={{ marginTop: -10 }}
                                            >
                                                <div className="bs-Fieldset-rows">
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <div
                                                            style={{
                                                                overflow:
                                                                    'hidden',
                                                                overflowX:
                                                                    'auto',
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <table className="Table">
                                                                <tbody className="Table-body">
                                                                    {backupCodes &&
                                                                    backupCodes.length >
                                                                        0 ? (
                                                                        backupCodes.map(
                                                                            code => (
                                                                                <tr
                                                                                    className="Table-row db-ListViewItem bs-ActionsParent scheduleListItem"
                                                                                    key={
                                                                                        code[0]
                                                                                            ? code[0]
                                                                                                  .code
                                                                                            : ''
                                                                                    }
                                                                                >
                                                                                    <td
                                                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                                        style={{
                                                                                            height:
                                                                                                '1px',
                                                                                        }}
                                                                                    >
                                                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-align--center">
                                                                                                <div className="Margin-right--7">
                                                                                                    <span
                                                                                                        className={
                                                                                                            code[0] &&
                                                                                                            code[0]
                                                                                                                .used
                                                                                                                ? 'cm-strikethrough'
                                                                                                                : ''
                                                                                                        }
                                                                                                    >
                                                                                                        {code[0]
                                                                                                            ? code[0]
                                                                                                                  .code
                                                                                                            : ''}
                                                                                                    </span>
                                                                                                </div>
                                                                                            </span>
                                                                                        </div>
                                                                                    </td>
                                                                                    <td
                                                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                                        style={{
                                                                                            height:
                                                                                                '1px',
                                                                                        }}
                                                                                    >
                                                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-align--center">
                                                                                                <div className="Margin-right--7">
                                                                                                    <span
                                                                                                        className={
                                                                                                            code[1] &&
                                                                                                            code[1]
                                                                                                                .used
                                                                                                                ? 'cm-strikethrough'
                                                                                                                : ''
                                                                                                        }
                                                                                                    >
                                                                                                        {code[1]
                                                                                                            ? code[1]
                                                                                                                  .code
                                                                                                            : ''}
                                                                                                    </span>
                                                                                                </div>
                                                                                            </span>
                                                                                        </div>
                                                                                    </td>
                                                                                </tr>
                                                                            )
                                                                        )
                                                                    ) : (
                                                                        <tr>
                                                                            <td>
                                                                                <ListLoader />
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <ShouldRender
                                        if={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'backupCodesState' does not exist on type... Remove this comment to see the full error message
                                            this.props.backupCodesState &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'backupCodesState' does not exist on type... Remove this comment to see the full error message
                                            this.props.backupCodesState.error
                                        }
                                    >
                                        <div className="bs-Tail-copy">
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
                                                        {
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'backupCodesState' does not exist on type... Remove this comment to see the full error message
                                                                .backupCodesState
                                                                .error
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={generateBackupCodes}
                                    >
                                        <span>Generate new codes</span>
                                    </button>
                                    <CopyToClipboard text={this.state.codes}>
                                        {this.state.copied &&
                                        this.state.close ? (
                                            <button
                                                className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                                type="button"
                                                onClick={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                                                    this.props.closeThisDialog
                                                }
                                            >
                                                <span>Close</span>
                                                <span className="create-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                        ) : (
                                            <button
                                                className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                                type="button"
                                                onClick={this.copyCodesHandler}
                                            >
                                                {this.state.copied &&
                                                !this.state.close ? (
                                                    <span>Copied</span>
                                                ) : (
                                                    <span>
                                                        Copy to clipboard
                                                    </span>
                                                )}
                                            </button>
                                        )}
                                    </CopyToClipboard>
                                </div>
                            </div>
                        </div>
                    </div>
                </ClickOutside>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
BackupCodesModal.displayName = 'BackupCodesModal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
BackupCodesModal.propTypes = {
    closeThisDialog: PropTypes.func,
    generateBackupCodes: PropTypes.func,
    profileSettings: PropTypes.object,
    backupCodesState: PropTypes.object,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            generateBackupCodes,
        },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        profileSettings: state.profileSettings.profileSetting,
        backupCodesState: state.profileSettings.backupCodes,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(BackupCodesModal);
