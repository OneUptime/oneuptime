import React from 'react';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { Validate } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import { Spinner } from '../basic/Loader';

function validate(values) {
    const errors = {};

    if (!Validate.text(values.projectName)) {
        errors.name = 'Project Name is required!';
    }

    return errors;
}

export function DeleteCaution(props) {
    const { hide, requesting, deleteProject, handleSubmit } = props;
    return (
        <form onSubmit={handleSubmit(deleteProject.bind(this))}>
            <div className="bs-Modal bs-Modal--medium">
                <div className="bs-Modal-header">
                    <div className="bs-Modal-header-copy">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                            <span>Delete Project</span>
                        </span>
                    </div>
                </div>
                <div className="bs-Modal-content">
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                        Are you sure you want to delete this project?
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
                            className={`bs-Button ${requesting &&
                                'bs-is-disabled'}`}
                            type="button"
                            onClick={hide}
                            disabled={requesting}
                        >
                            <span>Cancel</span>
                        </button>
                        <button
                            className={`bs-Button bs-Button--red Box-background--red ${requesting &&
                                'bs-is-disabled'}`}
                            disabled={requesting}
                            type="submit"
                        >
                            <ShouldRender if={requesting}>
                                <Spinner />
                            </ShouldRender>
                            <span>DELETE PERMANENTLY</span>
                        </button>
                    </div>
                </div>
            </div>
        </form>
    );
}

DeleteCaution.displayName = 'DeleteCaution';

DeleteCaution.propTypes = {
    hide: PropTypes.func.isRequired,
    deleteProject: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    handleSubmit: PropTypes.func,
};

export default reduxForm({
    form: 'DeleteCautionForm',
    validate,
})(DeleteCaution);
