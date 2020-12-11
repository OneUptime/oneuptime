import PropTypes from 'prop-types';
import React from 'react';
import { connect } from 'react-redux';
import { closeModal } from '../actions/modal';
class ExtraCharge extends React.Component {
    handleClick = () => {
        this.props.close();
    };
    render() {
        return (
            <div>
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
                                        <span>Why we charge your cards at sign up?</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                              <div>We've had few issues with toll fraud in the past
                                and we want to make sure our customers who sign  up to Fyipe
                                are 100% genuine. This is one of the steps we take to filter out
                                fraud. To learn about toll fraud,{' '}
                                 <span style={{cursor:'pointer', textDecoration:"underline"}}><a style={{color:'green',}} 
                                 href="https://www.twilio.com/learn/voice-and-video/toll-fraud"
                                   target="_blank" rel="noopener noreferrer">please click here</a></span>   
                             </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        type="button"
                                        onClick={this.handleClick}
                                    >
                                        <span>{'Close'}</span>
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

ExtraCharge.propTypes = {
    close: PropTypes.func,
};

ExtraCharge.displayName = 'ExtraCharge';

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = dispatch => {
    return {
        close: () => {
            dispatch(closeModal({ id: 1 }));
        },
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(ExtraCharge);
