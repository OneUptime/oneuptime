import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { closeModal } from '../../actions/modal';
import ReactJson from 'react-json-view';

class ViewJsonLogs extends Component {
    handleKeyBoard = e => {
        const { data, closeModal } = this.props;
        switch (e.key) {
            case 'Escape':
                return closeModal({
                    id: data.viewJsonModalId,
                });
            default:
                return false;
        }
    };

    render() {
        const { viewJsonModalId, title, jsonLog, rootName } = this.props.data;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            >
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
                                        <span>{title}</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <ReactJson
                                        src={jsonLog}
                                        theme="rjv-default"
                                        iconStyle="triangle"
                                        name={rootName ? rootName : false}
                                    />
                                </span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        type="button"
                                        onClick={() =>
                                            this.props.closeModal({
                                                id: viewJsonModalId,
                                            })
                                        }
                                    >
                                        <span>OK</span>
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

ViewJsonLogs.displayName = 'ViewJsonLogs';

ViewJsonLogs.propTypes = {
    closeModal: PropTypes.func.isRequired,
    data: PropTypes.object,
    title: PropTypes.string,
};

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ closeModal }, dispatch);
export default connect(mapStateToProps, mapDispatchToProps)(ViewJsonLogs);
