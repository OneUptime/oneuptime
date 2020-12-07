import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { updateCommunicationSla } from '../../actions/incidentCommunicationSla';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';

function validate(values) {
    const errors = {};

    if (!values.name || !values.name.trim()) {
        errors.name = 'Communication SLA name is required';
    }
    if (values.duration && values.duration.trim() && isNaN(values.duration)) {
        errors.duration = 'Only numeric values are allowed';
    }
    if (
        values.alertTime &&
        values.alertTime.trim() &&
        isNaN(values.alertTime)
    ) {
        errors.alertTime = 'Only numeric values are allowed';
    }
    if (Number(values.alertTime) >= Number(values.duration)) {
        errors.alertTime = 'Alert time should be less than duration';
    }
    return errors;
}

class EditIncidentCommunicationSlaModal extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        const {
            closeModal,
            editIncidentSlaModalId,
            currentProject,
            slaError,
            initialValues,
            updateCommunicationSla,
        } = this.props;
        const projectId = currentProject._id;
        const incidentSlaId = initialValues._id;
        const postObj = {};

        postObj.name = values.name;
        postObj.duration = values.duration;
        postObj.isDefault = values.isDefault;
        postObj.alertTime = values.alertTime;

        updateCommunicationSla(projectId, incidentSlaId, postObj).then(() => {
            if (!slaError) {
                closeModal({
                    id: editIncidentSlaModalId,
                });
            }
        });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.props.editIncidentSlaModalId,
                });
            case 'Enter':
                return document.getElementById('createSlaBtn').click();
            default:
                return false;
        }
    };

    render() {
        const {
            requesting,
            slaError,
            closeModal,
            handleSubmit,
            editIncidentSlaModalId,
        } = this.props;

        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 600 }}>
                        <div className="bs-Modal-header">
                            <div
                                className="bs-Modal-header-copy"
                                style={{
                                    marginBottom: '10px',
                                    marginTop: '10px',
                                }}
                            >
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Edit Incident Communication SLA</span>
                                </span>
                            </div>
                        </div>
                        <form
                            id="communicationSlaForm"
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
                                                    htmlFor="name"
                                                >
                                                    <span>SLA Name</span>
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
                                                            name="name"
                                                            placeholder="SLA name"
                                                            id="name"
                                                            className="bs-TextInput"
                                                            style={{
                                                                width: '100%',
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
                                                    htmlFor="duration"
                                                >
                                                    <span>
                                                        Duration (minutes)
                                                    </span>
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
                                                            name="duration"
                                                            placeholder="60"
                                                            id="duration"
                                                            className="bs-TextInput"
                                                            style={{
                                                                width: '100%',
                                                                padding:
                                                                    '3px 5px',
                                                            }}
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
                                                    htmlFor="alertTime"
                                                >
                                                    <span>
                                                        Alert Team before SLA is
                                                        breached.
                                                    </span>
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <div
                                                        className="bs-Fieldset-field"
                                                        style={{
                                                            width: '100%',
                                                            flexDirection:
                                                                'column',
                                                        }}
                                                    >
                                                        <Field
                                                            component={
                                                                RenderField
                                                            }
                                                            name="alertTime"
                                                            placeholder="60"
                                                            id="alertTime"
                                                            className="bs-TextInput"
                                                            style={{
                                                                width: '100%',
                                                                padding:
                                                                    '3px 5px',
                                                            }}
                                                        />
                                                        <p className="bs-Fieldset-explanation">
                                                            <span>
                                                                Alert X minutes
                                                                before SLA is
                                                                breached.
                                                            </span>
                                                        </p>
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
                                                    htmlFor="isDefault"
                                                >
                                                    <Field
                                                        component="input"
                                                        type="checkbox"
                                                        name="isDefault"
                                                        className="Checkbox-source"
                                                        id="isDefault"
                                                    />
                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                        <div className="Checkbox-target Box-root">
                                                            <div className="Checkbox-color Box-root"></div>
                                                        </div>
                                                    </div>
                                                    <div className="Checkbox-label Box-root Margin-left--8">
                                                        <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Set as Default
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
                                    <ShouldRender if={slaError}>
                                        <div
                                            className="bs-Tail-copy"
                                            style={{ width: 200 }}
                                        >
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        {slaError}
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
                                                id: editIncidentSlaModalId,
                                            })
                                        }
                                    >
                                        <span>Cancel</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                    <button
                                        id="editSlaBtn"
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
                    </div>
                </div>
            </div>
        );
    }
}

EditIncidentCommunicationSlaModal.displayName =
    'EditIncidentCommunicationSlaModal';

EditIncidentCommunicationSlaModal.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    slaError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    updateCommunicationSla: PropTypes.func,
    currentProject: PropTypes.object,
    initialValues: PropTypes.object,
    editIncidentSlaModalId: PropTypes.string,
};

const EditIncidentSlaForm = reduxForm({
    form: 'editIncidentSlaForm',
    enableReinitialize: false,
    validate,
    destroyOnUnmount: true,
})(EditIncidentCommunicationSlaModal);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            closeModal,
            updateCommunicationSla,
        },
        dispatch
    );

const mapStateToProps = state => {
    const incidentSlaToBeUpdated = state.modal.modals[0].sla;

    const initialValues = {};
    if (incidentSlaToBeUpdated) {
        initialValues.name = incidentSlaToBeUpdated.name;
        initialValues.isDefault = incidentSlaToBeUpdated.isDefault;
        initialValues.duration = incidentSlaToBeUpdated.duration;
        initialValues.alertTime = incidentSlaToBeUpdated.alertTime;
        initialValues._id = incidentSlaToBeUpdated._id;
    }

    return {
        editIncidentSlaModalId: state.modal.modals[0].id,
        initialValues,
        formValues:
            state.form.editIncidentSlaForm &&
            state.form.editIncidentSlaForm.values,
        requesting: state.incidentSla.incidentCommunicationSlas.requesting,
        slaError: state.incidentSla.incidentCommunicationSlas.error,
        currentProject: state.project.currentProject,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditIncidentSlaForm);
