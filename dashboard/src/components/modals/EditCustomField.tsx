import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

import { reduxForm, Field } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { updateCustomField } from '../../actions/customField';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!values.fieldName) {

        errors.fieldName = 'Field name is required';
    }
    return errors;
}

class UpdateCustomField extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const {

            closeModal,

            updateCustomFieldModalId,

            updateCustomField,

            projectId,

            initialValues,
        } = this.props;
        const postObj = {
            fieldName: values.fieldName,
            fieldType: values.fieldType,
            uniqueField: values.uniqueField,
        };

        updateCustomField({
            projectId,
            customFieldId: initialValues._id,
            data: postObj,
        }).then(() => {

            if (!this.props.updateFieldError) {
                closeModal({
                    id: updateCustomFieldModalId,
                });
            }
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document.getElementById('updateCustomField').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.updateCustomFieldModalId,
        });
    };

    render() {
        const {

            requesting,

            updateFieldError,

            closeModal,

            handleSubmit,
        } = this.props;

        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 600 }}>
                        <ClickOutside onClickOutside={this.handleCloseModal}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Update Custom Field</span>
                                    </span>
                                </div>
                            </div>
                            <form
                                id="customFieldForm"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="fieldName"
                                                    >
                                                        <span>Field Name</span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <Field
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="fieldName"
                                                                placeholder="Field name"
                                                                id="fieldName"
                                                                className="bs-TextInput"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '3px 5px',
                                                                }}
                                                                autoFocus={true}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="fieldType"
                                                    >
                                                        <span>Field Type</span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <Field
                                                                className="db-select-nw Table-cell--width--maximized"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="fieldType"
                                                                id="fieldType"
                                                                placeholder="Field type"
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                    width:
                                                                        '100%',
                                                                }}
                                                                options={[
                                                                    {
                                                                        value:
                                                                            'text',
                                                                        label:
                                                                            'Text',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'number',
                                                                        label:
                                                                            'Number',
                                                                    },
                                                                ]}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <div
                                                    className="Box-root"
                                                    style={{
                                                        height: '5px',
                                                    }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label
                                                        className="Checkbox"
                                                        htmlFor="uniqueField"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="uniqueField"
                                                            className="Checkbox-source"
                                                            id="uniqueField"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Make field
                                                                    unique
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={updateFieldError}>
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {updateFieldError}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() =>
                                                closeModal({
                                                    id: this.props

                                                        .updateCustomFieldModalId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="updateCustomField"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Update</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {requesting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}


UpdateCustomField.displayName = 'UpdateCustomField';


UpdateCustomField.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    updateCustomField: PropTypes.func.isRequired,
    updateCustomFieldModalId: PropTypes.string,
    initialValues: PropTypes.object,
    requesting: PropTypes.bool,
    updateFieldError: PropTypes.string,
    projectId: PropTypes.string,
};

const UpdateCustomFieldForm = reduxForm({
    form: 'UpdateCustomFieldForm',
    enableReinitialize: false,
    validate,
    destroyOnUnmount: true,
})(UpdateCustomField);

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        updateCustomField,
        closeModal,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    const customFieldToBeUpdated = state.modal.modals[0].customField;
    const initialValues = {};

    if (customFieldToBeUpdated) {

        initialValues.fieldName = customFieldToBeUpdated.fieldName;

        initialValues.fieldType = customFieldToBeUpdated.fieldType;

        initialValues._id = customFieldToBeUpdated._id;

        initialValues.uniqueField = customFieldToBeUpdated.uniqueField;
    }
    return {
        requesting: state.customField.customField.requesting,
        updateFieldError: state.customField.customField.error,
        updateCustomFieldModalId: state.modal.modals[0].id,
        projectId: state.modal.modals[0].projectId,
        initialValues,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(UpdateCustomFieldForm);
