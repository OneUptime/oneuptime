import React, { Fragment, Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import { resetDomain } from '../../actions/domain';
import { bindActionCreators } from 'redux';

class VerifyDomainModal extends Component {
    componentDidMount() {
        this.props.resetDomain();
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            case 'Enter':
                return this.props.confirmThisDialog();
            default:
                break;
        }
    };

    render() {
        const {
            confirmThisDialog,
            domainField,
            requesting,
            propArr,
            closeThisDialog,
        } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--large">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
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
                                                    {requesting && (
                                                        <Fragment>
                                                            <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink">
                                                                <td
                                                                    colSpan={7}
                                                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                    style={{
                                                                        height:
                                                                            '1px',
                                                                    }}
                                                                >
                                                                    <div className="db-ListViewItem-link">
                                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                            <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                <div className="Box-root">
                                                                                    <ListLoader />
                                                                                </div>
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        </Fragment>
                                                    )}
                                                    {propArr &&
                                                        propArr.length > 0 &&
                                                        propArr.map(
                                                            ({
                                                                _id,
                                                                verificationToken,
                                                            }) => (
                                                                <tr
                                                                    key={_id}
                                                                    className="Table-row db-ListViewItem bs-ActionsParent"
                                                                >
                                                                    <td
                                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                        style={{
                                                                            height:
                                                                                '1px',
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
                                                                            height:
                                                                                '1px',
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
                                                                            height:
                                                                                '1px',
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
                                                            )
                                                        )}
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
                                                if={
                                                    !domainField.requesting &&
                                                    domainField.error
                                                }
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
                                                                {
                                                                    domainField.error
                                                                }
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                        </div>
                                        <div
                                            style={{ display: 'flex' }}
                                            className="Margin-top--8 bs-u-self--end Text-align--right"
                                        >
                                            <button
                                                id="cancelVerifyDomain"
                                                className={`bs-Button btn__modal ${domainField.requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                disabled={
                                                    domainField.requesting
                                                }
                                                onClick={closeThisDialog}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="confirmVerifyDomain"
                                                className={`bs-Button bs-Button--blue btn__modal ${domainField.requesting &&
                                                    'bs-is-disabled'}`}
                                                onClick={() => {
                                                    confirmThisDialog();
                                                }}
                                                disabled={
                                                    domainField.requesting
                                                }
                                                autoFocus={true}
                                            >
                                                <span>Verify</span>
                                                <span className="create-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
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

const mapStateToProps = state => ({
    domainField: state.statusPage.verifyDomain,
    requesting: state.statusPage.requesting,
});

VerifyDomainModal.displayName = 'Domain verification';

VerifyDomainModal.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func,
    domainField: PropTypes.object,
    requesting: PropTypes.bool,
    propArr: PropTypes.array,
    resetDomain: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ resetDomain }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(VerifyDomainModal);
