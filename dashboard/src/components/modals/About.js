import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

class About extends Component {
    handleKeyBoard = (e) => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    }

    render() {
        let { versions } = this.props;

        return (
            <div onKeyDown={this.handleKeyBoard} className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
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
                                            <td>
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Server Version
                                                </span>
                                            </td>
                                            <td>
                                                <span style={{ paddingLeft: '15px' }} className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    <strong>{versions.server}</strong>
                                                </span>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Client Version
                                                </span>
                                            </td>
                                            <td>
                                                <span style={{ paddingLeft: '15px' }} className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    <strong>{versions.client}</strong>
                                                </span>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button className="bs-Button bs-DeprecatedButton bs-Button--grey" type="button" onClick={this.props.closeThisDialog}>
                                        <span>Close</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

About.displayName = 'AboutModal';

const mapStateToProps = (state) => {
    return {
        versions: state.version.versions,
    }
}

About.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    versions: PropTypes.object
};

export default connect(mapStateToProps)(About);