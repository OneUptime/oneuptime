import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { ListLoader } from '../basic/Loader.js';
import ShouldRender from '../basic/ShouldRender';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { generateBackupCodes } from '../../actions/profile.js';

class BackupCodesModal extends React.Component {
    state = {
        copied: false,
        codes: null,
    };

    componentDidMount() {
        const {
            profileSettings: { data },
        } = this.props;
        if (data.backupCodes && data.backupCodes.length > 0) {
            const codes = data.backupCodes.map(code => code.code);
            this.setState({ codes });
        }
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    copyCodesHandler = () => {
        this.setState({ copied: true });
    };

    refineCodes = () => {
        const {
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

    render() {
        const { generateBackupCodes, closeThisDialog } = this.props;
        const backupCodes = this.refineCodes();

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
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
                                        Two Factor Authentication Backup Codes
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
                                        <fieldset style={{ marginTop: -10 }}>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <div
                                                        style={{
                                                            overflow: 'hidden',
                                                            overflowX: 'auto',
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
                                                                    <ListLoader />
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
                                        this.props.backupCodesState &&
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
                                                <span style={{ color: 'red' }}>
                                                    {
                                                        this.props
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
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        type="button"
                                        onClick={this.copyCodesHandler}
                                    >
                                        {this.state.copied ? (
                                            <span>Copied</span>
                                        ) : (
                                            <span>Copy to clipboard</span>
                                        )}
                                    </button>
                                </CopyToClipboard>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

BackupCodesModal.displayName = 'BackupCodesModal';

BackupCodesModal.propTypes = {
    closeThisDialog: PropTypes.func,
    generateBackupCodes: PropTypes.func,
    profileSettings: PropTypes.object,
    backupCodesState: PropTypes.object,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            generateBackupCodes,
        },
        dispatch
    );
};

const mapStateToProps = state => {
    return {
        profileSettings: state.profileSettings.profileSetting,
        backupCodesState: state.profileSettings.backupCodes,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(BackupCodesModal);
