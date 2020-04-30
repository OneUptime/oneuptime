import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { fetchSsos, deleteSso, fetchSso } from '../../actions/sso';
import moment from 'moment';
import { openModal } from '../../actions/modal';
import SsoDeleteModal from './sso/SsoDeleteModal';
import { SsoAddModal, SsoUpdateModal, } from './sso/SsoModal';

export class Component extends React.Component {
    async componentDidMount() {
        await this.props.fetchSsos()
    }

    addSso = async () => {
        this.props.openModal({
            id: uuid.v4(),
            onConfirm: () => { },
            content: SsoAddModal,
        })
    }

    deleteSso = async  ssoId => {
        this.props.openModal({
            id: ssoId,
            onConfirm: async e => {
                await this.props.deleteSso(ssoId);
                return this.props.fetchSsos()
            },
            content: SsoDeleteModal,
        })
    }

    editSso = async ssoId => {
        this.props.fetchSso(ssoId)
        this.props.openModal({
            id: ssoId,
            onConfirm: async e => {
                return this.props.fetchSsos()
            },
            content: SsoUpdateModal,
        })
    }

    previousClicked = async () => {
        const { ssos } = this.props;
        const { skip, limit } = ssos
        await this.props.fetchSsos((skip - limit) >= 0 ? skip - limit : 0, limit)
    }

    nextClicked = async () => {
        const { ssos } = this.props;
        const { skip, limit } = ssos
        await this.props.fetchSsos(skip + limit, limit)
    }

    render() {
        const { ssos } = this.props;
        const { count, skip, limit } = ssos
        const canPrev = skip > 0;
        const canNext = skip + limit < count;
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span
                                        style={{
                                            textTransform:
                                                'capitalize',
                                        }}
                                    >
                                        Single sign-on (SSO)
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Admins and agents use your SSO service to
                                        sign in to Fyipe. Requires configuration.
                                    </span>
                                </span>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div className="Box-root">
                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                        <div>
                                            <button
                                                id="add-sso"
                                                className="bs-Button bs-ButtonLegacy ActionIconParent"
                                                type="button"
                                                onClick={
                                                    this.addSso
                                                }
                                                style={{
                                                    marginLeft:
                                                        '8px',
                                                }}
                                            >
                                                <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                    <span>
                                                        Add SSO
                                                    </span>
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div style={{ overflow: "auto hidden" }}>
                        <table className="Table">
                            <thead className="Table-body">
                                <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px", minWidth: "270px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span
                                            className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>
                                                domain
                                            </span>
                                        </span>
                                        </div>
                                    </td>
                                    <td id="placeholder-left"
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px", maxWidth: "48px", minWidth: "48px", width: "48px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span
                                                className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span
                                                className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                <span>
                                                    actions
                                                 </span>
                                            </span>
                                        </div>
                                    </td>
                                    <td id="placeholder-right"
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px", maxWidth: "48px", minWidth: "48px", width: "48px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span
                                                className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span
                                            className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>
                                                Created At
                                            </span>
                                        </span>
                                        </div>
                                    </td>
                                    <td id="overflow" type="action"
                                        className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span
                                                className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            </thead>
                            <tbody className="Table-body">
                                {ssos.count === 0 &&
                                    <tr
                                        className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                                    >
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                            style={{ height: "1px", minWidth: "270px" }}
                                            colSpan="5"
                                        >

                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span
                                                    className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div
                                                        id='no-sso-message'
                                                        style={{ textAlign: "center", marginTop: "10px" }}
                                                        className="Box-root Margin-right--16"
                                                    >
                                                        <span>
                                                            No SOOs created yet
                                                        </span>
                                                    </div>
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                }
                                {ssos.ssos.map(sso =>
                                    <tr
                                        key={sso._id}
                                        className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                                    >
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                            style={{ height: "1px", minWidth: "270px" }}>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span
                                                    className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Margin-right--16">
                                                        <span>
                                                            {sso.domain}
                                                        </span>
                                                    </div>
                                                </span>
                                            </div>
                                        </td>
                                        <td aria-hidden="true"
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: "1px", maxWidth: "48px", minWidth: "48px", width: "48px" }}>
                                            <div className="db-ListViewItem-link">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣
                                            </div>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: "1px" }}
                                        >
                                            <div className="db-ListViewItem-link">
                                                <button
                                                    className="bs-Button bs-Button--blue Box-background--blue edit-button"
                                                    onClick={() => this.editSso(sso._id)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    className="bs-Button bs-Button--red Box-background--red delete-button"
                                                    onClick={() => this.deleteSso(sso._id)}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                        <td aria-hidden="true"
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: "1px", maxWidth: "48px", minWidth: "48px", width: "48px" }}>
                                            <div className="db-ListViewItem-link">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣
                                           </div>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: "1px" }}>
                                            <div className="db-ListViewItem-link">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    {
                                                        moment(
                                                            sso.createdAt
                                                        ).fromNow()
                                                    }
                                                </div>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell">
                                        </td>
                                    </tr>
                                )
                                }
                            </tbody>
                        </table>

                        <div className="bs-Tail bs-Tail--separated bs-Tail--short">
                            <div className="bs-Tail-copy">
                                <span>
                                    {ssos.count}{' '}
                                    SSO
                                    {ssos.count === 1
                                        ? ''
                                        : 's'
                                    }
                                </span>
                            </div>
                            <div className="bs-Tail-actions">
                                <div className="ButtonGroup Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrev"
                                            onClick={this.previousClicked}
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canPrev
                                                    ? ''
                                                    : 'Is--disabled')
                                            }
                                            disabled={
                                                !canPrev
                                            }
                                            data-db-analytics-name="list_view.pagination.previous"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span>
                                                        Previous
                                </span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <div className="Box-root">
                                        <button
                                            id="btnNext"
                                            onClick={this.nextClicked}
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canNext
                                                    ? ''
                                                    : 'Is--disabled')
                                            }
                                            disabled={
                                                !canNext
                                            }
                                            data-db-analytics-name="list_view.pagination.next"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span>
                                                        Next
                                </span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div >
        );
    }
}

Component.displayName = 'SettingsForm';

/* eslint-disable */
Component.propTypes = {
    ssos: PropTypes.object.isRequired,
    fetchSsos: PropTypes.func.isRequired,
    fetchSso: PropTypes.func.isRequired,
    deleteSso: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchSsos,
            fetchSso,
            deleteSso,
            openModal,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        ssos: state.sso.ssos,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(Component);
