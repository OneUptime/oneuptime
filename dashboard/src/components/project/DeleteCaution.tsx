import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import { IS_SAAS_SERVICE, Validate } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import { Spinner } from '../basic/Loader';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.projectName)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Project Name is required!';
    }

    return errors;
}

class DeleteCaution extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                if (IS_SAAS_SERVICE) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideOnDelete' does not exist on type 'Re... Remove this comment to see the full error message
                    this.props.hideOnDelete();
                }
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'hide' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                return this.props.hide();
            case 'Enter':
                if (e.target.localName !== 'textarea') {
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    return document.getElementById('btnDeleteProject').click();
                }
                return;
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'hide' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            hide,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteProject' does not exist on type 'R... Remove this comment to see the full error message
            deleteProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteSuccess' does not exist on type 'R... Remove this comment to see the full error message
            deleteSuccess,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideOnDelete' does not exist on type 'Re... Remove this comment to see the full error message
            hideOnDelete,
        } = this.props;
        // eslint-disable-next-line no-console

        return (
            <form
                id="delete-project-form"
                onSubmit={handleSubmit(deleteProject.bind(this))}
            >
                <div className="bs-Modal bs-Modal--medium">
                    {IS_SAAS_SERVICE && deleteSuccess ? (
                        <>
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Delete Project</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    Your subscription has been cancelled and
                                    your card will not be charged.
                                </span>
                                <br />
                                <br />
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className={`bs-Button btn__modal ${requesting &&
                                            'bs-is-disabled'}`}
                                        type="button"
                                        onClick={hideOnDelete}
                                        disabled={requesting}
                                    >
                                        <span>Close</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Delete Project</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    Are you sure you want to delete this
                                    project?
                                </span>
                                <br />
                                <br />
                                <div>
                                    <Field
                                        required={true}
                                        component="textarea"
                                        name="feedback"
                                        placeholder="Please tell us why you want to delete this project"
                                        id="feedback"
                                        className="bs-TextArea bs-TextArea--x-tall"
                                    />
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
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                    <button
                                        className={`bs-Button bs-Button--red Box-background--red delete_btn__modal ${requesting &&
                                            'bs-is-disabled'}`}
                                        disabled={requesting}
                                        type="submit"
                                        autoFocus={true}
                                        id="btnDeleteProject"
                                    >
                                        <ShouldRender if={requesting}>
                                            <Spinner />
                                        </ShouldRender>
                                        <span>DELETE PERMANENTLY</span>
                                        <span className="delete-btn__keycode">
                                            <span className="keycode__icon keycode__icon--enter" />
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </form>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DeleteCaution.displayName = 'DeleteCaution';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DeleteCaution.propTypes = {
    hide: PropTypes.func.isRequired,
    deleteProject: PropTypes.func.isRequired,
    hideOnDelete: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    handleSubmit: PropTypes.func,
    deleteSuccess: PropTypes.bool,
};

export default reduxForm({
    form: 'DeleteCautionForm',
    validate,
})(DeleteCaution);
