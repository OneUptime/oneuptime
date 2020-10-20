import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { changeDeleteModal } from '../../actions/project';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { IS_SAAS_SERVICE } from '../../config';

class DeleteMessaging extends Component {
    handleClick = () => {
        this.props.changeDeleteModal();
    };
    render() {
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
                        <div className="icon_display-msg">
                            <div className="clear_times"></div>
                            <div className="clear_msg_txt">
                                We will stop monitoring your resources.
                            </div>
                        </div>
                        <div className="icon_display-msg">
                            <div className="clear_times"></div>
                            <div className="clear_msg_txt">
                                Your customers, users and team will lose access
                                to the status page.
                            </div>
                        </div>
                        <div className="icon_display-msg">
                            <div className="clear_times"></div>
                            <div className="clear_msg_txt">
                                Your team will NOT be alerted during downtime.
                            </div>
                        </div>
                        {
                            IS_SAAS_SERVICE &&
                            <div className='icon_display-msg'>
                                <div className='clear_times'></div><div className='clear_msg_txt'>Your card will not be charged and your subscription is cancelled.</div>
                            </div>
                        }
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
                            // autoFocus={true}
                            id="btnDeleteProject"
                            onClick={this.handleClick}
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

DeleteMessaging.displayName = 'DeleteMessaging';
DeleteMessaging.propTypes = {
    changeDeleteModal: PropTypes.func.isRequired,
    hide: PropTypes.func.isRequired,
    requesting: PropTypes.bool.isRequired,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            changeDeleteModal,
        },
        dispatch
    );

export default connect(null, mapDispatchToProps)(DeleteMessaging);
