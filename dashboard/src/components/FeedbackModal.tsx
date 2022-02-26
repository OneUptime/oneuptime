import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import {
    createFeedback,
    closeFeedbackModal,
    resetCreateFeedback,
} from '../actions/feedback';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { RenderTextArea } from './basic/RenderTextArea';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reset } from 'redux-form';
import PropTypes from 'prop-types';

export class FeedbackModal extends Component {
    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reset' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { reset, page } = this.props;

        if (values.feedback) {
            this.props
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createFeedback' does not exist on type '... Remove this comment to see the full error message
                .createFeedback(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    values.feedback,
                    page.title
                )
                .then(
                    function() {},
                    function() {}
                );

            reset();
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'feedback' does not exist on type 'Readon... Remove this comment to see the full error message
        const { success, error } = this.props.feedback.feedback;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'feedback' does not exist on type 'Readon... Remove this comment to see the full error message
        return this.props.feedback.feedbackModalVisble ? (
            <div
                className="db-FeedbackModal"
                style={{
                    position: 'absolute',
                    left: '50vw',
                    top: '50vh',
                    marginTop: -75,
                    marginLeft: -145,
                    zIndex: '999',
                }}
            >
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideFeedbackModal' does not exist on typ... Remove this comment to see the full error message
                <ClickOutside onClickOutside={this.props.hideFeedbackModal}>
                    <div className="db-FeedbackModal-background" />
                    <div className="db-FeedbackModal-content">
                        <div className="db-FeedbackModal-contentInner">
                            <div className="db-FeedbackModal-icon" />
                            <div className="db-FeedbackForm">
                                <form onSubmit={handleSubmit(this.submitForm)}>
                                    <span>
                                        <div className="db-FeedbackForm-step db-FeedbackForm-step--form">
                                            {!error && !success && (
                                                <Field
                                                    component={RenderTextArea}
                                                    className="db-FeedbackForm-textarea"
                                                    placeholder={
                                                        'Anything we can do to help?'
                                                    }
                                                    defaultValue={''}
                                                    name="feedback"
                                                    style={{
                                                        height: '100px',
                                                    }}
                                                />
                                            )}
                                            {error && !success && (
                                                <span className="db-FeedbackForm-error">
                                                    Sorry we were unable to send
                                                    your feedback to the support
                                                    team. This could be because
                                                    of bad network connection.
                                                    Can you please write to us
                                                    at{' '}
                                                    <b>
                                                        support@oneuptime.com{' '}
                                                    </b>{' '}
                                                    instead?
                                                </span>
                                            )}

                                            {!error && success && (
                                                <span className="db-FeedbackForm-success">
                                                    Thank you for reaching out.
                                                    We will get back to you in
                                                    less than 1 business day.
                                                </span>
                                            )}
                                            <span />
                                            {error ? (
                                                <span className="bs-active-in"></span>
                                            ) : null}
                                            <div className="db-FeedbackForm-actions">
                                                <button
                                                    className="bs-Button bs-DeprecatedButton db-FeedbackForm-cancel"
                                                    type="button"
                                                    onClick={() => {
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetCreateFeedback' does not exist on t... Remove this comment to see the full error message
                                                        this.props.resetCreateFeedback();
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeFeedbackModal' does not exist on ty... Remove this comment to see the full error message
                                                        this.props.closeFeedbackModal();
                                                    }}
                                                >
                                                    <span>
                                                        {success || error
                                                            ? 'Close'
                                                            : 'Cancel'}
                                                    </span>
                                                </button>
                                                {!error && !success && (
                                                    <button
                                                        className="bs-Button bs-DeprecatedButton db-FeedbackForm-submit bs-Button--blue"
                                                        id="feedback-button"
                                                        type="submit"
                                                    >
                                                        <span>
                                                            Contact Support
                                                        </span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </span>
                                </form>
                            </div>
                        </div>
                    </div>
                </ClickOutside>
            </div>
        ) : null;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
FeedbackModal.displayName = 'FeedbackModal';

const FeedbackModalForm = reduxForm({
    form: 'FeedbackModal', // a unique identifier for this form
})(FeedbackModal);

const mapStateToProps = (state: $TSFixMe) => ({
    feedback: state.feedback,
    page: state.page,
    currentProject: state.project.currentProject
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { createFeedback, closeFeedbackModal, reset, resetCreateFeedback },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
FeedbackModal.propTypes = {
    page: PropTypes.object,
    createFeedback: PropTypes.func.isRequired,
    closeFeedbackModal: PropTypes.func.isRequired,
    reset: PropTypes.func.isRequired,
    feedback: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    hideFeedbackModal: PropTypes.func,
    resetCreateFeedback: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(FeedbackModalForm);
