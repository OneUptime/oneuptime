import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ClickOutside from 'react-click-outside';
class About extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
            case 'Enter':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        const { versions, closeThisDialog, probes } = this.props;
        const currentYear = new Date().getFullYear();
        let probeVersion = null;
        if (probes && probes.length > 0) {
            probeVersion = probes.map((probe, i) => {
                return (
                    <tr key={i}>
                        <td>
                            <span
                                className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                id="probe-version"
                            >
                                {probe.probeName} Version
                            </span>
                        </td>
                        <td>
                            <span
                                style={{
                                    paddingLeft: '15px',
                                }}
                                className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                            >
                                {probe.version ? (
                                    <strong id="probe-version">
                                        {probe.version}
                                    </strong>
                                ) : null}
                            </span>
                        </td>
                    </tr>
                );
            });
        }

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal bs-Modal--medium">
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>About</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <table>
                                        <tbody>
                                            <tr>
                                                <td
                                                    style={{
                                                        paddingBottom: '10px',
                                                    }}
                                                    colSpan={2}
                                                >
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                        OneUptime is a product
                                                        of{' '}
                                                        <a
                                                            href="https://hackerbay.io"
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                        >
                                                            HackerBay, Inc.
                                                        </a>
                                                        . HackerBay, Inc. is a
                                                        United States Delaware C
                                                        Corporation.
                                                    </span>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td>
                                                    <span
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                        id="server-version"
                                                    >
                                                        Server Version
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        style={{
                                                            paddingLeft: '15px',
                                                        }}
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                    >
                                                        {versions.server ? (
                                                            <strong id="server-version">
                                                                {
                                                                    versions.server
                                                                }
                                                            </strong>
                                                        ) : null}
                                                    </span>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td>
                                                    <span
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                        id="admin-dashboard-version"
                                                    >
                                                        Admin Dashboard Version
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        style={{
                                                            paddingLeft: '15px',
                                                        }}
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                    >
                                                        {versions.adminDashboard ? (
                                                            <strong id="admin-dashboard-version">
                                                                {
                                                                    versions.adminDashboard
                                                                }
                                                            </strong>
                                                        ) : null}
                                                    </span>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td>
                                                    <span
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                        id="dashboard-version"
                                                    >
                                                        Dashboard Version
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        style={{
                                                            paddingLeft: '15px',
                                                        }}
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                    >
                                                        {versions.dashboard ? (
                                                            <strong id="dashboard-version">
                                                                {
                                                                    versions.dashboard
                                                                }
                                                            </strong>
                                                        ) : null}
                                                    </span>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td>
                                                    <span
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                        id="docs-version"
                                                    >
                                                        Docs Version
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        style={{
                                                            paddingLeft: '15px',
                                                        }}
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                    >
                                                        {versions.docs ? (
                                                            <strong id="docs-version">
                                                                {versions.docs}
                                                            </strong>
                                                        ) : null}
                                                    </span>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td>
                                                    <span
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                        id="helm-version"
                                                    >
                                                        Helm Chart Version
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        style={{
                                                            paddingLeft: '15px',
                                                        }}
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                    >
                                                        {versions.helm ? (
                                                            <strong id="helm-version">
                                                                {versions.helm}
                                                            </strong>
                                                        ) : null}
                                                    </span>
                                                </td>
                                            </tr>
                                            {probeVersion}
                                            <tr>
                                                <td
                                                    style={{
                                                        paddingTop: '20px',
                                                    }}
                                                    colSpan={2}
                                                >
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                        <a
                                                            href="https://oneuptime.com/legal"
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                        >
                                                            Legal Center
                                                        </a>
                                                        <span
                                                            style={{
                                                                paddingLeft:
                                                                    '10px',
                                                            }}
                                                        >
                                                            |
                                                        </span>
                                                    </span>
                                                    <span
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                        style={{
                                                            paddingLeft: '10px',
                                                        }}
                                                    >
                                                        <a
                                                            href="https://oneuptime.com/legal/terms"
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                        >
                                                            Terms of Use
                                                        </a>
                                                        <span
                                                            style={{
                                                                paddingLeft:
                                                                    '10px',
                                                            }}
                                                        >
                                                            |
                                                        </span>
                                                    </span>
                                                    <span
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                        style={{
                                                            paddingLeft: '10px',
                                                        }}
                                                    >
                                                        <a
                                                            href="https://oneuptime.com/legal/privacy"
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                        >
                                                            Privacy Policy
                                                        </a>
                                                        <span
                                                            style={{
                                                                paddingLeft:
                                                                    '10px',
                                                            }}
                                                        >
                                                            |
                                                        </span>
                                                    </span>
                                                    <span
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                        style={{
                                                            paddingLeft: '10px',
                                                        }}
                                                    >
                                                        <a
                                                            href="https://oneuptime.com/legal/sla"
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                        >
                                                            SLA
                                                        </a>
                                                    </span>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="bs-Modal-footer">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Copyright © {currentYear} HackerBay,
                                        Inc.
                                    </span>
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={this.props.closeThisDialog}
                                            autoFocus={true}
                                        >
                                            <span>Close</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

About.displayName = 'AboutModal';

const mapStateToProps = state => {
    return {
        versions: state.version.versions,
        probes: state.probe.probes.data,
    };
};

About.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    versions: PropTypes.object,
    probes: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
};

export default connect(mapStateToProps)(About);
