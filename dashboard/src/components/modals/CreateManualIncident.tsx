import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field, change, formValueSelector } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { createNewIncident, createIncidentReset } from '../../actions/incident';
import { closeModal } from '../../actions/modal';
import { ValidateField } from '../../config';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderField } from '../basic/RenderField';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import { fetchCustomFields } from '../../actions/customField';

class CreateManualIncident extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            incidentType: '',
            loading: false,
        };
    }

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchCustomFields' does not exist on typ... Remove this comment to see the full error message
        const { fetchCustomFields } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { projectId } = this.props.data;
        fetchCustomFields(projectId);

        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createNewIncident' does not exist on typ... Remove this comment to see the full error message
            createNewIncident,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentModalId' does not exist on... Remove this comment to see the full error message
            createIncidentModalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentReset' does not exist on t... Remove this comment to see the full error message
            createIncidentReset,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { projectId, monitorId } = this.props.data;
        const monitor = [monitorId];
        this.setState({ incidentType: values.incidentType });
        const thisObj = this;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'customFields' does not exist on type 'Re... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentReset' does not exist on t... Remove this comment to see the full error message
        const { createIncidentReset } = this.props;

        if (e.key) {
            if (e.key === 'Escape') {
                createIncidentReset();
                this.handleCloseModal();
            }
            if (e.key === 'Enter' && e.target.localName !== 'textarea') {
                document.getElementById('createIncident') &&
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    document.getElementById('createIncident').click();
            }
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentModalId' does not exist on... Remove this comment to see the full error message
            id: this.props.createIncidentModalId,
        });
    };

    setTemplateValues = (value: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { change, incidentTemplateObj } = this.props;

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

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'newIncident' does not exist on type 'Rea... Remove this comment to see the full error message
            newIncident,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentPriorities' does not exist on ty... Remove this comment to see the full error message
            incidentPriorities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'customFields' does not exist on type 'Re... Remove this comment to see the full error message
            customFields,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentTemplateObj' does not exist on t... Remove this comment to see the full error message
            incidentTemplateObj,
        } = this.props;
        const sameError =
            newIncident &&
            newIncident.error &&
            newIncident.error ===
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentType' does not exist on type 'Re... Remove this comment to see the full error message
                `An unresolved incident of type ${this.state.incidentType} already exists.`
                ? true
                : false;
        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'newIncident' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'newIncident' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'newIncident' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'newIncident' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'newIncident' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentType' does not exist on type 'Re... Remove this comment to see the full error message
                                                    {this.state.incidentType}{' '}
                                                    already exists. Please
                                                    resolve earlier incidents of
                                                    type{' '}
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentType' does not exist on type 'Re... Remove this comment to see the full error message
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
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'newIncident' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentReset' does not exist on t... Remove this comment to see the full error message
                                                this.props.createIncidentReset();
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                                                this.props.closeModal({
                                                    id: this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentModalId' does not exist on... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'loading' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'loading' does not exist on type 'Readonl... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
CreateManualIncident.displayName = 'CreateManualIncident';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

const formName = 'CreateManualIncident';
const selector = formValueSelector(formName);

function mapStateToProps(state: $TSFixMe) {
    const { currentProject } = state.project;
    const incidentTemplateObj = state.incidentBasicSettings.incidentTemplates;
    const defaultTemplateObj = state.incidentBasicSettings.defaultTemplate;

    const incidentType = 'offline';
    const initialValues = {
        incidentType,
    };

    const defaultTemplate = defaultTemplateObj.template;
    if (defaultTemplate) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentTemplate' does not exist on type... Remove this comment to see the full error message
        initialValues.incidentTemplate = defaultTemplate._id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type '{ inciden... Remove this comment to see the full error message
        initialValues.title = defaultTemplate.title;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'description' does not exist on type '{ i... Remove this comment to see the full error message
        initialValues.description = defaultTemplate.description;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentPriority' does not exist on type... Remove this comment to see the full error message
        initialValues.incidentPriority =
            defaultTemplate.incidentPriority?._id ||
            defaultTemplate.incidentPriority;
    }

    const selectedIncidentType = selector(state, 'incidentType');
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

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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

const CreateManualIncidentForm = reduxForm({
    form: formName,
    enableReinitialize: true,
    destroyOnUnmount: true,
})(CreateManualIncident);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateManualIncidentForm);
