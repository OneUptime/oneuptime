import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import ConsoleLogView from '../monitor/ConsoleLogView';

class ViewScriptLogs extends Component {
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
                return this.handleCloseModal();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        this.props.closeModal({
            id: this.props.data.viewScriptLogModalId,
        });
    };

    render() {
        const {
            viewScriptLogModalId,
            title,
            consoleLogs,
            rootName,
        } = this.props.data;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--large">
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span
                                                id={
                                                    title &&
                                                    typeof title === 'string'
                                                        ? title.replace(
                                                              / /g,
                                                              '_'
                                                          )
                                                        : 'console_logs'
                                                }
                                            >
                                                {title}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <div
                                    className="bs-Modal-content Text-overflow--scroll Text-wrap--wrap"
                                    style={{ backgroundColor: '#000000' }}
                                >
                                    {/* show console logs here */}
                                    <ConsoleLogView
                                        consoleLogs={consoleLogs}
                                        name={rootName}
                                    />
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={() =>
                                                this.props.closeModal({
                                                    id: viewScriptLogModalId,
                                                })
                                            }
                                            autoFocus={true}
                                        >
                                            <span>Close</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
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

ViewScriptLogs.displayName = 'ViewScriptLogs';

ViewScriptLogs.propTypes = {
    closeModal: PropTypes.func.isRequired,
    data: PropTypes.object,
    title: PropTypes.string,
};

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ closeModal }, dispatch);
export default connect(mapStateToProps, mapDispatchToProps)(ViewScriptLogs);
