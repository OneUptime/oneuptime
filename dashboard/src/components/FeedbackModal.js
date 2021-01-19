import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import { createFeedback, closeFeedbackModal } from '../actions/feedback';
import { reduxForm, Field } from 'redux-form';
import ClickOutside from 'react-click-outside';
import { RenderTextArea } from './basic/RenderTextArea';
import { reset } from 'redux-form';
import PropTypes from 'prop-types';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';

export class FeedbackModal extends Component {
    state = { innerWidth: null };

    componentDidMount() {
        window.addEventListener('resize', () => {
            this.setState({ innerWidth: window.innerWidth });
        });
    }

    componentWillUnmount() {
        window.removeEventListener('resize', () => {
            this.setState({ innerWidth: window.innerWidth });
        });
    }

    submitForm = values => {
        const { reset, page } = this.props;

        if (values.feedback) {
            this.props
                .createFeedback(
                    this.props.currentProject._id,
                    values.feedback,
                    page.title
                )
                .then(
                    function() {},
                    function() {}
                );

            if (SHOULD_LOG_ANALYTICS) {
                logEvent('EVENT: DASHBOARD > FEEDBACK FORM SUBMIT', values);
            }
            this.props.closeFeedbackModal();

            reset();
        }
    };

    render() {
        const { handleSubmit } = this.props;
        const { innerWidth } = this.state;

        return this.props.feedback.feedbackModalVisble ? (
            <div
                className="db-FeedbackModal"
                style={{
                    position: 'absolute',
                    right:
                        innerWidth > 1440
                            ? 'calc((50vw - 1390px / 2 ))'
                            : '20px',
                    top: '20px',
                    zIndex: '999',
                }}
            >
                <ClickOutside onClickOutside={this.props.hideFeedbackModal}>
                    <div className="db-FeedbackModal-background" />
                    <div className="db-FeedbackModal-content">
                        <div className="db-FeedbackModal-contentInner">
                            <div className="db-FeedbackModal-icon" />
                            <div className="db-FeedbackForm">
                                <form onSubmit={handleSubmit(this.submitForm)}>
                                    <span>
                                        <div className="db-FeedbackForm-step db-FeedbackForm-step--form">
                                            <Field
                                                component={RenderTextArea}
                                                className="db-FeedbackForm-textarea"
                                                placeholder="Anything we can do to help?"
                                                defaultValue={''}
                                                name="feedback"
                                                style={{ height: '100px' }}
                                            />
                                            <span />
                                            <div className="db-FeedbackForm-actions">
                                                <button
                                                    className="bs-Button bs-DeprecatedButton db-FeedbackForm-cancel"
                                                    type="button"
                                                    onClick={() =>
                                                        this.props.closeFeedbackModal()
                                                    }
                                                >
                                                    <span>Cancel</span>
                                                </button>
                                                <button
                                                    className="bs-Button bs-DeprecatedButton db-FeedbackForm-submit bs-Button--blue"
                                                    id="feedback-button"
                                                    type="submit"
                                                >
                                                    <span>Send feedback</span>
                                                </button>
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

FeedbackModal.displayName = 'FeedbackModal';

const FeedbackModalForm = reduxForm({
    form: 'FeedbackModal', // a unique identifier for this form
})(FeedbackModal);

const mapStateToProps = state => ({
    feedback: state.feedback,
    page: state.page,
    currentProject: state.project.currentProject,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators({ createFeedback, closeFeedbackModal, reset }, dispatch);

FeedbackModal.propTypes = {
    page: PropTypes.object,
    createFeedback: PropTypes.func.isRequired,
    closeFeedbackModal: PropTypes.func.isRequired,
    reset: PropTypes.func.isRequired,
    feedback: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    hideFeedbackModal: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(FeedbackModalForm);
