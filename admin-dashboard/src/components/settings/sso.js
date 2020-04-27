import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { fetchSettings, saveSettings } from '../../actions/settings';
import { fetchSsos, deleteSso } from '../../actions/sso';
import moment from 'moment';
import { openModal, closeModal } from '../../actions/modal';
import SsoDeleteModal from './sso/SsoDeleteModal';
import SsoAddModal from './sso/SsoAddModal';


const settingsType = 'sso';

export class Component extends React.Component {
    async componentDidMount() {
        await this.props.fetchSettings(settingsType);
        await this.props.fetchSsos()
    }

    submitForm = values => {
        this.props.saveSettings(settingsType, values);
    };

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

    addSso = async () => {
        this.props.openModal({
            id: uuid.v4(),
            onConfirm: (e) => {e.preventDefault() },
            content: SsoAddModal,
        })
    }

    render() {
        const { ssos } = this.props;
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <div className="Flex-flex Flex-alignItems-center Flex-justifyContent--spaceBetween">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Single sign-on (SSO)</span>
                                </span>
                            </div>
                            <p>
                                <span>
                                    Admins and agents use your SSO service to
                                    sign in to Fyipe. Requires configuration.
                                </span>
                            </p>
                            <button
                                onClick={() => this.addSso()}
                            >
                                Add
                            </button>
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
                                                            {sso.samlSsoUrl}
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
                                                <button className="bs-Button bs-Button--blue Box-background--blue">
                                                    Edit
                                            </button>
                                                <button
                                                    className="bs-Button bs-Button--red Box-background--red"
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
                    </div>
                </div>
            </div>
        );
    }
}

Component.displayName = 'SettingsForm';

/* eslint-disable */
Component.propTypes = {
    settings: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    saveSettings: PropTypes.func.isRequired,
    fetchSettings: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            saveSettings,
            fetchSettings,
            fetchSsos,
            deleteSso,
            openModal,
            closeModal,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        settings: state.settings,
        initialValues: state.settings[settingsType],
        ssoForm: state.form['sso-form'],
        ssos: state.sso.ssos,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(Component);
