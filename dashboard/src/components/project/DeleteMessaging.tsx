import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { changeDeleteModal } from '../../actions/project';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

class DeleteMessaging extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'hide' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                return this.props.hide();
            case 'Enter':
                if (e.target.localName !== 'textarea') {
                    return this.handleClick();
                }
                return;
            default:
                return false;
        }
    };

    handleClick = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'changeDeleteModal' does not exist on typ... Remove this comment to see the full error message
        this.props.changeDeleteModal();
    };
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'hide' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { hide, requesting } = this.props;
        return (
            <div className="bs-Modal bs-Modal--medium">
                <div className="bs-Modal-header">
                    <div className="bs-Modal-header-copy">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                            <span>Delete Project</span>
                        </span>
                    </div>
                </div>
                <div className="bs-Modal-content">
                    <div>
                        <div
                            className="icon_display-msg"
                            style={{
                                display: 'flex',
                            }}
                        >
                            <div className="clear_times"></div>
                            <div className="clear_msg_txt">
                                We will stop monitoring your resources.
                            </div>
                        </div>
                        <div
                            className="icon_display-msg"
                            style={{
                                display: 'flex',
                                margin: '10px 0',
                            }}
                        >
                            <div
                                className="clear_times"
                                style={{ width: '17px' }}
                            ></div>
                            <div className="clear_msg_txt">
                                Your customers, users and team will lose access
                                to the status page.
                            </div>
                        </div>
                        <div
                            className="icon_display-msg"
                            style={{
                                display: 'flex',
                                margin: '10px 0',
                            }}
                        >
                            <div className="clear_times"></div>
                            <div className="clear_msg_txt">
                                Your team will NOT be alerted during downtime.
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bs-Modal-footer">
                    <div className="bs-Modal-footer-actions">
                        <button
                            className={`bs-Button btn__modal ${requesting &&
                                'bs-is-disabled'}`}
                            type="button"
                            onClick={hide}
                            disabled={requesting}
                        >
                            <span>Cancel</span>
                            <span className="cancel-btn__keycode">Esc</span>
                        </button>
                        <button
                            className={`bs-Button bs-Button--red Box-background--red btn__modal ${requesting &&
                                'bs-is-disabled'}`}
                            disabled={requesting}
                            type="button"
                            id="btnDeleteProject"
                            onClick={this.handleClick}
                            autoFocus={true}
                        >
                            {/* <ShouldRender if={requesting}>
                                    <Spinner />
                                </ShouldRender> */}
                            <span>PROCEED</span>
                            <span className="delete-btn__keycode">
                                <span className="keycode__icon keycode__icon--enter" />
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DeleteMessaging.displayName = 'DeleteMessaging';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DeleteMessaging.propTypes = {
    changeDeleteModal: PropTypes.func.isRequired,
    hide: PropTypes.func.isRequired,
    requesting: PropTypes.bool.isRequired,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        changeDeleteModal,
    },
    dispatch
);

export default connect(null, mapDispatchToProps)(DeleteMessaging);
