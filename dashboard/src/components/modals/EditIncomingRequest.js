import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field, FieldArray } from 'redux-form';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { editIncomingRequest } from '../../actions/incomingRequest';

function validate(values) {
    const errors = {};

    if (!values.name || !values.name.trim()) {
        errors.name = 'Incoming request name is required';
    }

    return errors;
}

class EditIncomingRequest extends Component {
    state = {
        monitorError: null,
    };

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        const {
            closeModal,
            editIncomingRequest,
            projectId,
            initialValues,
        } = this.props;
        const requestId = initialValues._id;
        const postObj = {};

        postObj.name = values.name;
        postObj.isDefault = values.isDefault;
        postObj.createIncident = values.createIncident;
        if (postObj.createIncident) {
            postObj.filterCriteria = values.filterCriteria;
            postObj.filterCondition = values.filterCondition;
            postObj.filterText = values.filterText;
        }

        postObj.monitors = [];
        if (!postObj.isDefault) {
            if (values.monitors && values.monitors.length > 0) {
                const monitors = values.monitors.filter(
                    monitorId => typeof monitorId === 'string'
                );
                postObj.monitors = monitors;
            }

            const isDuplicate = postObj.monitors
                ? postObj.monitors.length === new Set(postObj.monitors).size
                    ? false
                    : true
                : false;

            if (isDuplicate) {
                this.setState({
                    monitorError: 'Duplicate monitor selection found',
                });
                postObj.monitors = [];
                return;
            }
        }

        editIncomingRequest(projectId, requestId, postObj).then(() => {
            if (!this.props.requesting && !this.props.requestError) {
                closeModal({
                    id: projectId, // the projectId was used as the id for this modal
                });
            }
        });
    };

    renderMonitors = ({ fields }) => {
        const { monitorError } = this.state;
        return (
            <>
                <div
                    style={{
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    <button
                        id="addMoreMonitor"
                        className="Button bs-ButtonLegacy ActionIconParent"
                        style={{
                            position: 'absolute',
                            zIndex: 1,
                            right: 0,
                        }}
                        type="button"
                        onClick={() => {
                            fields.push();
                        }}
                    >
                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                            <span>Add Monitor</span>
                        </span>
                    </button>
                    {fields.map((field, index) => {
                        return (
                            <div
                                style={{
                                    width: '65%',
                                    marginBottom: 10,
                                }}
                                key={index}
                            >
                                <Field
                                    className="db-select-nw Table-cell--width--maximized"
                                    component={RenderSelect}
                                    name={field}
                                    id={`monitorfield_${index}`}
                                    placeholder="Monitor"
                                    style={{
                                        height: '28px',
                                        width: '100%',
                                    }}
                                    options={[
                                        {
                                            value: '',
                                            label: 'Select a Monitor',
                                        },
                                        ...(this.props.monitors &&
                                        this.props.monitors.length > 0
                                            ? this.props.monitors.map(
                                                  monitor => ({
                                                      value: monitor._id,
                                                      label: `${monitor.componentId.name} / ${monitor.name}`,
                                                  })
                                              )
                                            : []),
                                    ]}
                                />
                                <button
                                    id="removeMonitor"
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    style={{
                                        marginTop: 10,
                                    }}
                                    type="button"
                                    onClick={() => {
                                        fields.remove(index);
                                    }}
                                >
                                    <span className="bs-Button bs-Button--icon bs-Button--delete">
                                        <span>Remove Monitor</span>
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                    {monitorError && (
                        <div
                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                            style={{
                                marginTop: '5px',
                                alignItems: 'center',
                            }}
                        >
                            <div
                                className="Box-root Margin-right--8"
                                style={{ marginTop: '2px' }}
                            >
                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                            </div>
                            <div className="Box-root">
                                <span
                                    id="monitorError"
                                    style={{ color: 'red' }}
                                >
                                    {monitorError}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </>
        );
    };

    handleKeyBoard = e => {
        const { closeModal, projectId } = this.props;

        switch (e.key) {
            case 'Escape':
                return closeModal({
                    id: projectId,
                });
            case 'Enter':
                return document.getElementById('editIncomingRequest').click();
            default:
                return false;
        }
    };

    render() {
        const { handleSubmit, projectId, formValues, closeModal } = this.props;

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
                                    <span>Edit Incoming Request</span>
                                </span>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit(this.submitForm)}>
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
                                                    htmlFor="endpoint"
                                                >
                                                    <span>Name</span>
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
                                                            type="input"
                                                            placeholder="Name of request"
                                                            id="name"
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
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

                                    {formValues && !formValues.isDefault && (
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="endpoint"
                                                    >
                                                        <span>Monitors</span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <FieldArray
                                                                name="monitors"
                                                                component={
                                                                    this
                                                                        .renderMonitors
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    )}

                                    <fieldset className="Margin-bottom--16">
                                        <div className="bs-Fieldset-rows">
                                            <div
                                                className="bs-Fieldset-row"
                                                style={{ padding: 0 }}
                                            >
                                                <label
                                                    className="bs-Fieldset-label Text-align--left"
                                                    htmlFor="isDefault"
                                                >
                                                    <span></span>
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        paddingTop: '6px',
                                                    }}
                                                >
                                                    <div className="bs-Fieldset-field">
                                                        <label
                                                            className="Checkbox"
                                                            style={{
                                                                marginRight:
                                                                    '12px',
                                                            }}
                                                            htmlFor="isDefault"
                                                        >
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name="isDefault"
                                                                className="Checkbox-source"
                                                                id="isDefault"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <span>
                                                                    Use as
                                                                    default
                                                                    incoming
                                                                    request
                                                                </span>
                                                            </div>
                                                        </label>
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
                                                    htmlFor="createIncident"
                                                >
                                                    <span></span>
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        paddingTop: '6px',
                                                    }}
                                                >
                                                    <div className="bs-Fieldset-field">
                                                        <label
                                                            className="Checkbox"
                                                            style={{
                                                                marginRight:
                                                                    '12px',
                                                            }}
                                                            htmlFor="createIncident"
                                                        >
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name="createIncident"
                                                                className="Checkbox-source"
                                                                id="createIncident"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <span>
                                                                    Create
                                                                    Incident
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                    {formValues && formValues.createIncident && (
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span>Filters</span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
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
                                                                name="filterCriteria"
                                                                id="filterCriteria"
                                                                placeholder="Criteria"
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                    width:
                                                                        '100%',
                                                                }}
                                                                options={[
                                                                    {
                                                                        value:
                                                                            'thirdPartyVariables',
                                                                        label:
                                                                            'Third Party Variables',
                                                                    },
                                                                ]}
                                                            />
                                                            <Field
                                                                className="db-select-nw Table-cell--width--maximized"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="filterCondition"
                                                                id="filterCondition"
                                                                placeholder="Condition"
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                    width:
                                                                        '100%',
                                                                    marginLeft: 5,
                                                                }}
                                                                options={[
                                                                    {
                                                                        value:
                                                                            'equalTo',
                                                                        label:
                                                                            'Equal To',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'notEqualTo',
                                                                        label:
                                                                            'Not Equal To',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'greaterThan',
                                                                        label:
                                                                            'Greater Than',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'lessThan',
                                                                        label:
                                                                            'Less Than',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'lessThanOrEqualTo',
                                                                        label:
                                                                            'Less Than Or Equal To',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'greaterThanOrEqualTo',
                                                                        label:
                                                                            'Greater Than Or Equal To',
                                                                    },
                                                                ]}
                                                            />
                                                            <Field
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="filterText"
                                                                type="input"
                                                                placeholder="Text to filter"
                                                                id="filterText"
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '3px 5px',
                                                                    marginLeft: 5,
                                                                }}
                                                                autoFocus={true}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    )}
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <ShouldRender
                                        if={
                                            !this.props.requesting &&
                                            this.props.requestError
                                        }
                                    >
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
                                                        {
                                                            this.props
                                                                .requestError
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button
                                        className="bs-Button bs-DeprecatedButton btn__modal"
                                        type="button"
                                        onClick={() =>
                                            closeModal({ id: projectId })
                                        }
                                    >
                                        <span>Cancel</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                        disabled={this.props.requesting}
                                        type="submit"
                                        id="editIncomingRequest"
                                    >
                                        {!this.props.requesting && (
                                            <>
                                                <span>Edit</span>
                                                <span className="create-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </>
                                        )}
                                        {this.props.requesting && (
                                            <FormLoader />
                                        )}
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

EditIncomingRequest.displayName = 'EditIncomingRequest';

EditIncomingRequest.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    monitors: PropTypes.array,
    editIncomingRequest: PropTypes.func,
    requesting: PropTypes.bool,
    requestError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    formValues: PropTypes.object,
    initialValues: PropTypes.object,
    projectId: PropTypes.string,
};

const EditIncomingRequestForm = reduxForm({
    form: 'editIncomingRequestForm', // a unique identifier for this form
    enableReinitialize: true,
    validate, // <--- validation function given to redux-form
    destroyOnUnmount: true,
})(EditIncomingRequest);

const mapDispatchToProps = dispatch =>
    bindActionCreators({ editIncomingRequest, closeModal }, dispatch);

const mapStateToProps = state => {
    const incomingRequestToBeUpdated = state.modal.modals[0].incomingRequest;
    const projectId = state.modal.modals[0].projectId;

    const initialValues = {};

    if (incomingRequestToBeUpdated) {
        initialValues.name = incomingRequestToBeUpdated.name;
        initialValues.isDefault = incomingRequestToBeUpdated.isDefault;
        initialValues.createIncident =
            incomingRequestToBeUpdated.createIncident;
        initialValues._id = incomingRequestToBeUpdated._id;
        initialValues.filterCriteria =
            incomingRequestToBeUpdated.filterCriteria;
        initialValues.filterCondition =
            incomingRequestToBeUpdated.filterCondition;
        initialValues.filterText = incomingRequestToBeUpdated.filterText;
    }

    const monitorData = state.monitor.monitorsList.monitors.find(
        data => String(data._id) === String(projectId)
    );
    const monitors = monitorData ? monitorData.monitors : [];
    if (!initialValues.isDefault) {
        initialValues.monitors = incomingRequestToBeUpdated.monitors.map(
            monitor => monitor.monitorId._id
        );
    }

    return {
        monitors,
        requesting: state.incomingRequest.updateIncomingRequest.requesting,
        requestError: state.incomingRequest.updateIncomingRequest.error,
        formValues:
            state.form.editIncomingRequestForm &&
            state.form.editIncomingRequestForm.values,
        initialValues,
        projectId,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditIncomingRequestForm);
