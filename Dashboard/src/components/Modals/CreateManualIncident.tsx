import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { reduxForm, Field, change, formValueSelector } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { createNewIncident, createIncidentReset } from '../../actions/incident';
import { closeModal } from 'CommonUI/actions/Modal';
import { ValidateField } from '../../config';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderField } from '../basic/RenderField';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import { fetchCustomFields } from '../../actions/customField';

interface CreateManualIncidentProps {
    incidentPriorities: unknown[];
    closeModal: Function;
    createIncidentModalId?: string;
    createIncidentReset: Function;
    createNewIncident: Function;
    data?: object;
    handleSubmit: Function;
    monitorId?: string;
    newIncident?: object;
    change: Function;
    fetchCustomFields?: Function;
    customFields?: unknown[];
    incidentTemplateObj?: object;
}

class CreateManualIncident extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            incidentType: '',
            loading: false,
        };
    }

    override componentDidMount() {

        const { fetchCustomFields }: $TSFixMe = this.props;

        const { projectId }: $TSFixMe = this.props.data;
        fetchCustomFields(projectId);

        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const {

            createNewIncident,

            createIncidentModalId,

            closeModal,

            createIncidentReset,
        } = this.props;

        const { projectId, monitorId }: $TSFixMe = this.props.data;
        const monitor: $TSFixMe = [monitorId];
        this.setState({ incidentType: values.incidentType });
        const thisObj: $TSFixMe = this;


        const customFields = this.props.customFields.map((field: $TSFixMe) => ({
            fieldName: field.fieldName,
            fieldType: field.fieldType,
            uniqueField: field.uniqueField,

            fieldValue:
                field.fieldType === 'number'
                    ? parseFloat(values[field.fieldName])
                    : values[field.fieldName]
        }));

        this.setState({ loading: true });

        createNewIncident(
            projectId,
            monitor,
            values.incidentType,
            values.title,
            values.description,
            values.incidentPriority === '' ? null : values.incidentPriority,
            customFields
        )
            .then(() => {
                createIncidentReset();
                thisObj.setState({ loading: false });
                closeModal({
                    id: createIncidentModalId,
                });
            })
            .catch(() => {
                // added this to fix
                // unhandled error bug
                thisObj.setState({ loading: false });
            });
    };

    handleKeyBoard = (e: $TSFixMe) => {

        const { createIncidentReset }: $TSFixMe = this.props;

        if (e.key) {
            if (e.key === 'Escape') {
                createIncidentReset();
                this.handleCloseModal();
            }
            if (e.key === 'Enter' && e.target.localName !== 'textarea') {
                document.getElementById('createIncident') &&

                    document.getElementById('createIncident').click();
            }
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.createIncidentModalId,
        });
    };

    setTemplateValues = (value: $TSFixMe) => {

        const { change, incidentTemplateObj }: $TSFixMe = this.props;

        if (value) {
            !incidentTemplateObj.requesting &&
                incidentTemplateObj.templates.forEach((template: $TSFixMe) => {
                    if (String(template._id) === String(value)) {
                        change('title', template.title);
                        change('description', template.description);
                        template.incidentPriority &&
                            change(
                                'incidentPriority',
                                template.incidentPriority._id ||
                                template.incidentPriority
                            );
                    }
                });
        }
    };

    override render() {
        const {

            handleSubmit,

            newIncident,

            incidentPriorities,

            customFields,

            incidentTemplateObj,
        } = this.props;
        const sameError: $TSFixMe =
            newIncident &&
                newIncident.error &&
                newIncident.error ===

                `An unresolved incident of type ${this.state.incidentType} already exists.`
                ? true
                : false;
        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div
                        className="bs-Modal bs-Modal--medium"
                        style={{ width: 570 }}
                    >
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
                                        <span id="incidentTitleLabel">
                                            Create New Incident
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <form
                                onSubmit={handleSubmit(
                                    this.submitForm.bind(this)
                                )}
                            >
                                <div className="bs-Modal-content bs-u-paddingless">
                                    <div className="bs-Modal-block bs-u-paddingless">
                                        <div className="bs-Modal-content">
                                            <ShouldRender if={!sameError}>
                                                <div className="bs-Fieldset-row Margin-bottom--12">
                                                    <label className="bs-Fieldset-label">
                                                        Incident type
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-select-nw db-select-fw"
                                                            component={
                                                                RenderSelect
                                                            }
                                                            name="incidentType"
                                                            id="incidentType"
                                                            placeholder="Incident type"
                                                            disabled={
                                                                this.props

                                                                    .newIncident
                                                                    .requesting
                                                            }
                                                            validate={
                                                                ValidateField.select
                                                            }
                                                            options={[
                                                                {
                                                                    value:
                                                                        'online',
                                                                    label:
                                                                        'Online',
                                                                },
                                                                {
                                                                    value:
                                                                        'offline',
                                                                    label:
                                                                        'Offline',
                                                                },
                                                                {
                                                                    value:
                                                                        'degraded',
                                                                    label:
                                                                        'Degraded',
                                                                },
                                                            ]}
                                                            autoFocus={true}
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                                {!incidentTemplateObj.requesting &&
                                                    incidentTemplateObj
                                                        .templates.length >
                                                    1 && (
                                                        <div className="bs-Fieldset-row Margin-bottom--12">
                                                            <label className="bs-Fieldset-label">
                                                                Incident
                                                                Templates
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-select-nw db-select-fw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name="incidentTemplate"
                                                                    id="incidentTemplate"
                                                                    placeholder="Incident template"
                                                                    disabled={
                                                                        this
                                                                            .props

                                                                            .newIncident
                                                                            .requesting
                                                                    }
                                                                    options={[
                                                                        ...incidentTemplateObj.templates.map(
                                                                            (template: $TSFixMe) => ({
                                                                                value:
                                                                                    template._id,

                                                                                label:
                                                                                    template.name
                                                                            })
                                                                        ),
                                                                    ]}
                                                                    onChange={(
                                                                        event: $TSFixMe,
                                                                        newValue: $TSFixMe
                                                                    ) =>
                                                                        this.setTemplateValues(
                                                                            newValue
                                                                        )
                                                                    }
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                <ShouldRender
                                                    if={
                                                        incidentPriorities.length >
                                                        0
                                                    }
                                                >
                                                    <div className="bs-Fieldset-row Margin-bottom--12">
                                                        <label className="bs-Fieldset-label">
                                                            Priority
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-select-nw db-select-fw"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="incidentPriority"
                                                                id="incidentPriority"
                                                                placeholder="Incident Priority"
                                                                disabled={
                                                                    this.props

                                                                        .newIncident
                                                                        .requesting
                                                                }
                                                                options={[
                                                                    ...incidentPriorities.map(
                                                                        (incidentPriority: $TSFixMe) => ({
                                                                            value:
                                                                                incidentPriority._id,

                                                                            label:
                                                                                incidentPriority.name
                                                                        })
                                                                    ),
                                                                ]}
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Incident title
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            name="title"
                                                            id="title"
                                                            placeholder="Incident title"
                                                            disabled={
                                                                this.props

                                                                    .newIncident
                                                                    .requesting
                                                            }
                                                            validate={[
                                                                ValidateField.required,
                                                            ]}
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label script-label">
                                                        Description
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            name="description"
                                                            id="description"
                                                            component={
                                                                RenderCodeEditor
                                                            }
                                                            mode="markdown"
                                                            height="150px"
                                                            width="100%"
                                                            placeholder="This can be markdown"
                                                            wrapEnabled={true}
                                                        />
                                                    </div>
                                                </div>
                                                {customFields &&
                                                    customFields.length > 0 && (
                                                        <>
                                                            {customFields.map(
                                                                (
                                                                    field: $TSFixMe,
                                                                    index: $TSFixMe
                                                                ) => (
                                                                    <div
                                                                        key={
                                                                            index
                                                                        }
                                                                        className="bs-Fieldset-row Margin-bottom--12"
                                                                    >
                                                                        <label className="bs-Fieldset-label">
                                                                            {
                                                                                field.fieldName
                                                                            }
                                                                        </label>
                                                                        <div className="bs-Fieldset-fields">
                                                                            <Field
                                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                                component={
                                                                                    RenderField
                                                                                }
                                                                                name={
                                                                                    field.fieldName
                                                                                }
                                                                                id={
                                                                                    field.fieldName
                                                                                }
                                                                                type={
                                                                                    field.fieldType
                                                                                }
                                                                                disabled={
                                                                                    this
                                                                                        .props

                                                                                        .newIncident
                                                                                        .requesting
                                                                                }
                                                                                style={{
                                                                                    width:
                                                                                        '100%',
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                )
                                                            )}
                                                        </>
                                                    )}
                                            </ShouldRender>
                                            <ShouldRender if={sameError}>
                                                <span>
                                                    An unresolved incident of
                                                    type{' '}

                                                    {this.state.incidentType}{' '}
                                                    already exists. Please
                                                    resolve earlier incidents of
                                                    type{' '}

                                                    {this.state.incidentType} to
                                                    create a new incident.
                                                </span>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{
                                            width: '100%',
                                            flexWrap: 'nowrap',
                                        }}
                                    >
                                        <ShouldRender
                                            if={
                                                newIncident &&
                                                newIncident.error &&
                                                !sameError
                                            }
                                        >
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
                                                            {
                                                                this.props

                                                                    .newIncident
                                                                    .error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            onClick={() => {

                                                this.props.createIncidentReset();

                                                this.props.closeModal({
                                                    id: this.props

                                                        .createIncidentModalId,
                                                });
                                            }}
                                        >
                                            <ShouldRender if={!sameError}>
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </ShouldRender>
                                            <ShouldRender if={sameError}>
                                                <span>OK</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </ShouldRender>
                                        </button>
                                        <ShouldRender if={!sameError}>
                                            <button
                                                id="createIncident"
                                                className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                                disabled={
                                                    newIncident &&
                                                    newIncident.requesting
                                                }
                                                type="submit"
                                            >
                                                {newIncident &&
                                                    !newIncident.requesting &&

                                                    !this.state.loading && (
                                                        <>
                                                            <span>Create</span>
                                                            <span className="create-btn__keycode">
                                                                <span className="keycode__icon keycode__icon--enter" />
                                                            </span>
                                                        </>
                                                    )}
                                                {newIncident &&
                                                    (newIncident.requesting ||

                                                        this.state.loading) && (
                                                        <FormLoader />
                                                    )}
                                            </button>
                                        </ShouldRender>
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


CreateManualIncident.displayName = 'CreateManualIncident';

CreateManualIncident.propTypes = {
    incidentPriorities: PropTypes.array.isRequired,
    closeModal: PropTypes.func.isRequired,
    createIncidentModalId: PropTypes.string,
    createIncidentReset: PropTypes.func.isRequired,
    createNewIncident: PropTypes.func.isRequired,
    data: PropTypes.object,
    handleSubmit: PropTypes.func.isRequired,
    monitorId: PropTypes.string,
    newIncident: PropTypes.object,
    change: PropTypes.func.isRequired,
    fetchCustomFields: PropTypes.func,
    customFields: PropTypes.array,
    incidentTemplateObj: PropTypes.object,
};

const  formName: string = 'CreateManualIncident';
const selector: $TSFixMe = formValueSelector(formName);

function mapStateToProps(state: RootState) {
    const { currentProject }: $TSFixMe = state.project;
    const incidentTemplateObj: $TSFixMe = state.incidentBasicSettings.incidentTemplates;
    const defaultTemplateObj: $TSFixMe = state.incidentBasicSettings.defaultTemplate;

    const  incidentType: string = 'offline';
    const initialValues: $TSFixMe = {
        incidentType,
    };

    const defaultTemplate: $TSFixMe = defaultTemplateObj.template;
    if (defaultTemplate) {

        initialValues.incidentTemplate = defaultTemplate._id;

        initialValues.title = defaultTemplate.title;

        initialValues.description = defaultTemplate.description;

        initialValues.incidentPriority =
            defaultTemplate.incidentPriority?._id ||
            defaultTemplate.incidentPriority;
    }

    const selectedIncidentType: $TSFixMe = selector(state, 'incidentType');
    return {
        newIncident: state.incident.newIncident,
        createIncidentModalId: state.modal.modals[0].id,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
        incidentBasicSettings:
            state.incidentBasicSettings.incidentBasicSettings,
        initialValues,
        currentProject,
        selectedIncidentType,
        customFields: state.customField.customFields.fields,
        incidentTemplateObj,
    };
}

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            createNewIncident,
            closeModal,
            createIncidentReset,
            change,
            fetchCustomFields,
        },
        dispatch
    );
};

const CreateManualIncidentForm: $TSFixMe = reduxForm({
    form: formName,
    enableReinitialize: true,
    destroyOnUnmount: true,
})(CreateManualIncident);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateManualIncidentForm);
