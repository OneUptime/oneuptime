import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field, change, formValueSelector } from 'redux-form';
import moment from 'moment';
import handlebars from 'handlebars';
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
    constructor(props) {
        super(props);
        this.state = {
            incidentType: '',
            titleEdited: false,
            descriptionEdited: false,
        };
    }

    componentDidMount() {
        const { fetchCustomFields } = this.props;
        const { projectId } = this.props.data;
        fetchCustomFields(projectId);

        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        const {
            createNewIncident,
            createIncidentModalId,
            closeModal,
            createIncidentReset,
        } = this.props;
        const { projectId, monitorId } = this.props.data;
        this.setState({ incidentType: values.incidentType });

        const customFields = this.props.customFields.map(field => ({
            fieldName: field.fieldName,
            fieldValue:
                field.fieldType === 'number'
                    ? parseFloat(values[field.fieldName])
                    : values[field.fieldName],
        }));

        createNewIncident(
            projectId,
            monitorId,
            values.incidentType,
            values.title,
            values.description,
            values.incidentPriority === '' ? null : values.incidentPriority,
            customFields
        ).then(() => {
            createIncidentReset();
            closeModal({
                id: createIncidentModalId,
            });
        });
    };

    handleKeyBoard = e => {
        const {
            createIncidentModalId,
            closeModal,
            createIncidentReset,
        } = this.props;
        switch (e.key) {
            case 'Escape':
                createIncidentReset();
                return closeModal({
                    id: createIncidentModalId,
                });
            case 'Enter':
                return document.getElementById('createIncident').click();
            default:
                return false;
        }
    };

    substituteVariables = (value, name) => {
        const { titleEdited, descriptionEdited } = this.state;
        const {
            incidentBasicSettings,
            change,
            data: { monitor },
            currentProject,
            selectedIncidentType,
        } = this.props;

        const titleTemplate = handlebars.compile(incidentBasicSettings.title);
        const descriptionTemplate = handlebars.compile(
            incidentBasicSettings.description
        );

        const values = {
            incidentType: selectedIncidentType,
            monitorName: monitor.name,
            projectName: currentProject.name,
            time: moment().format('h:mm:ss a'),
            date: moment().format('MMM Do YYYY'),
        };

        values[name] = value;

        if (!titleEdited) change('title', titleTemplate(values));

        if (!descriptionEdited)
            change('description', descriptionTemplate(values));
    };

    render() {
        const {
            handleSubmit,
            newIncident,
            incidentPriorities,
            customFields,
        } = this.props;
        const sameError =
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
                    <div className="bs-Modal bs-Modal--medium">
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
                            onSubmit={handleSubmit(this.submitForm.bind(this))}
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
                                                        className="db-select-nw"
                                                        component={RenderSelect}
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
                                                                value: 'online',
                                                                label: 'Online',
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
                                                        onChange={(
                                                            event,
                                                            newValue,
                                                            previousValue,
                                                            name
                                                        ) =>
                                                            this.substituteVariables(
                                                                newValue,
                                                                name
                                                            )
                                                        }
                                                        autoFocus={true}
                                                    />
                                                </div>
                                            </div>
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
                                                            className="db-select-nw"
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
                                                                    incidentPriority => ({
                                                                        value:
                                                                            incidentPriority._id,
                                                                        label:
                                                                            incidentPriority.name,
                                                                    })
                                                                ),
                                                            ]}
                                                            onChange={(
                                                                event,
                                                                newValue,
                                                                previousValue,
                                                                name
                                                            ) =>
                                                                this.substituteVariables(
                                                                    newValue,
                                                                    name
                                                                )
                                                            }
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
                                                        component={RenderField}
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
                                                        onChange={() =>
                                                            this.setState({
                                                                titleEdited: true,
                                                            })
                                                        }
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
                                                        component={
                                                            RenderCodeEditor
                                                        }
                                                        mode="markdown"
                                                        height="150px"
                                                        width="100%"
                                                        placeholder="This can be markdown"
                                                        wrapEnabled={true}
                                                        onChange={() =>
                                                            this.setState({
                                                                descriptionEdited: true,
                                                            })
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            {customFields &&
                                                customFields.length > 0 && (
                                                    <>
                                                        {customFields.map(
                                                            (field, index) => (
                                                                <div
                                                                    key={index}
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
                                                An unresolved incident of type{' '}
                                                {this.state.incidentType}{' '}
                                                already exists. Please resolve
                                                earlier incidents of type{' '}
                                                {this.state.incidentType} to
                                                create a new incident.
                                            </span>
                                        </ShouldRender>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
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
                                                !newIncident.requesting && (
                                                    <>
                                                        <span>Create</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                            {newIncident &&
                                                newIncident.requesting && (
                                                    <FormLoader />
                                                )}
                                        </button>
                                    </ShouldRender>
                                </div>
                            </div>
                        </form>
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
    incidentBasicSettings: PropTypes.object.isRequired,
    selectedIncidentType: PropTypes.string.isRequired,
    currentProject: PropTypes.object.isRequired,
    fetchCustomFields: PropTypes.func,
    customFields: PropTypes.array,
};

const formName = 'CreateManualIncident';
const selector = formValueSelector(formName);

function mapStateToProps(state, props) {
    const { data } = props;
    const { monitor } = data;
    const { currentProject } = state.project;
    const incidentType = 'offline';
    const values = {
        incidentType,
        monitorName: monitor.name,
        projectName: currentProject.name,
        time: moment().format('h:mm:ss a'),
        date: moment().format('MMM Do YYYY'),
    };
    const titleTemplate = handlebars.compile(
        state.incidentBasicSettings.incidentBasicSettings.title
    );
    const descriptionTemplate = handlebars.compile(
        state.incidentBasicSettings.incidentBasicSettings.description
    );
    const initialValues = {
        incidentType,
        title: titleTemplate(values),
        description: descriptionTemplate(values),
        incidentPriority:
            state.incidentBasicSettings.incidentBasicSettings.incidentPriority,
    };
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
    };
}

const mapDispatchToProps = dispatch => {
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
})(CreateManualIncident);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateManualIncidentForm);
