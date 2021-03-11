import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field, FieldArray } from 'redux-form';
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { editIncomingRequest } from '../../actions/incomingRequest';
import { RenderTextArea } from '../basic/RenderTextArea';
import Tooltip from '../basic/Tooltip';
import { incomingRequestVariables } from '../../config';
import { fetchCustomFields } from '../../actions/customField';
import { fetchCustomFields as fetchMonitorCustomFields } from '../../actions/monitorCustomField';
import CodeEditor from '../basic/CodeEditor';

function validate(values) {
    const errors = {};

    if (!values.name || !values.name.trim()) {
        errors.name = 'Incoming request name is required';
    }

    return errors;
}

const bulletpoints = {
    display: 'listItem',
    listStyleType: 'disc',
    listStylePosition: 'inside',
};

class EditIncomingRequest extends Component {
    state = {
        monitorError: null,
    };

    componentDidMount() {
        const {
            fetchCustomFields,
            projectId,
            fetchMonitorCustomFields,
        } = this.props;
        fetchCustomFields(projectId);
        fetchMonitorCustomFields(projectId);

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
            destroy,
            customFields,
        } = this.props;
        const requestId = initialValues._id;
        const postObj = {};

        postObj.name = values.name;

        postObj.filterMatch = values.filterMatch;
        postObj.filters =
            values.filters && values.filters.length > 0
                ? values.filters
                      .filter(filter => !!filter)
                      .map(filter => {
                          if (!isNaN(filter.filterText)) {
                              if (typeof filter.filterText === 'string') {
                                  filter.filterText = String(filter.filterText);
                              } else {
                                  filter.filterText = parseFloat(
                                      filter.filterText
                                  );
                              }
                          }

                          return filter;
                      })
                : [];

        if (values.nextAction && values.nextAction === 'createIncident') {
            postObj.isDefault = values.isDefault;
            postObj.createIncident = true;
            postObj.incidentTitle = values.incidentTitle;
            postObj.incidentType = values.incidentType;
            if (values.dynamicIncidentType) {
                postObj.customIncidentType = values.customIncidentType;
                postObj.dynamicIncidentType = values.dynamicIncidentType;
            }
            postObj.incidentPriority = values.incidentPriority;
            if (values.dynamicIncidentPriority) {
                // create this incident priority on the BE
                postObj.customIncidentPriority = values.customIncidentPriority;
                postObj.dynamicIncidentPriority =
                    values.dynamicIncidentPriority;
            }
            postObj.incidentDescription = values.incidentDescription;

            postObj.customFields = customFields.map(field => ({
                fieldName: field.fieldName,
                fieldType: field.fieldType,
                uniqueField: field.uniqueField,
                fieldValue:
                    field.fieldType === 'number'
                        ? parseFloat(values[field.fieldName])
                        : values[field.fieldName],
            }));

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
        }

        if (values.nextAction && values.nextAction === 'updateIncidentNote') {
            postObj.updateIncidentNote = true;
        }

        if (values.nextAction && values.nextAction === 'updateInternalNote') {
            postObj.updateInternalNote = true;
        }

        if (
            values.nextAction &&
            (values.nextAction === 'updateIncidentNote' ||
                values.nextAction === 'updateInternalNote')
        ) {
            postObj.noteContent = values.noteContent;
            postObj.incidentState = values.incidentState;
            if (values.incidentState === 'others') {
                postObj.incidentState = values.customIncidentState;
            }
        }

        if (values.nextAction && values.nextAction === 'acknowledgeIncident') {
            postObj.acknowledgeIncident = true;
        }

        if (values.nextAction && values.nextAction === 'resolveIncident') {
            postObj.resolveIncident = true;
        }

        editIncomingRequest(projectId, requestId, postObj).then(() => {
            if (!this.props.requesting && !this.props.requestError) {
                destroy();
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
                                                      label: `${monitor.projectId.name} / ${monitor.componentId.name} / ${monitor.name}`,
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

    renderCustomFields = ({ fields }) => {
        const { formValues, customFields } = this.props;
        return (
            <>
                <div
                    style={{
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    <span
                        id="addCustomField"
                        onClick={() => {
                            fields.push();
                        }}
                    ></span>
                    {fields.map((field, index) => {
                        const fieldType = (
                            customFields.find(
                                customField =>
                                    String(customField._id) ===
                                    String(
                                        (formValues.customFields[index] || {})
                                            .fieldName
                                    )
                            ) || {}
                        ).fieldType;

                        return (
                            <div
                                style={{
                                    width: '100%',
                                    marginBottom: 10,
                                }}
                                key={index}
                            >
                                <div className="Flex-flex">
                                    <Field
                                        className="db-select-nw Table-cell--width--maximized"
                                        component={RenderSelect}
                                        name={`${field}.fieldName`}
                                        id={`${field}.fieldName`}
                                        placeholder="Field Name"
                                        style={{
                                            height: '28px',
                                            width: '100%',
                                        }}
                                        options={[
                                            {
                                                value: '',
                                                label: 'Select a field',
                                            },
                                            ...customFields.map(
                                                customField => ({
                                                    value: customField._id,
                                                    label:
                                                        customField.fieldName,
                                                })
                                            ),
                                        ]}
                                    />
                                    <Field
                                        component={RenderField}
                                        name={`${field}.fieldValue`}
                                        type={
                                            formValues && fieldType
                                                ? fieldType
                                                : 'input'
                                        }
                                        placeholder="Field Value"
                                        id={`${field}.fieldValue`}
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        style={{
                                            width: '100%',
                                            padding: '3px 5px',
                                        }}
                                        parentStyle={{
                                            marginLeft: 5,
                                        }}
                                    />
                                </div>
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
                                        <span>Remove Field</span>
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                </div>
            </>
        );
    };

    renderFilters = ({ fields }) => {
        const { monitorError, filterShowing } = this.state;
        const { formValues, monitorCustomFields, customFields } = this.props;

        if (
            !filterShowing &&
            formValues &&
            (!formValues.filters || formValues.filters.length === 0)
        ) {
            // show at least one filter initially
            fields.push();
            this.setState({ filterShowing: true });
        }

        return (
            <>
                <div
                    style={{
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    <span
                        id="addFilter"
                        onClick={() => {
                            fields.push();
                        }}
                    ></span>
                    {fields.map((field, index) => {
                        return (
                            <div
                                style={{
                                    width: '100%',
                                    marginBottom: 10,
                                }}
                                key={index}
                            >
                                <div
                                    className="bs-Fieldset-field"
                                    style={{
                                        width: '100%',
                                    }}
                                >
                                    {formValues &&
                                    formValues.nextAction ===
                                        'createIncident' ? (
                                        <Field
                                            className="db-select-nw Table-cell--width--maximized"
                                            component={RenderSelect}
                                            name={`${field}.filterCriteria`}
                                            id={`${field}.filterCriteria`}
                                            placeholder="Criteria"
                                            style={{
                                                height: '28px',
                                                width: '100%',
                                            }}
                                            options={[
                                                ...monitorCustomFields.map(
                                                    field => ({
                                                        value: field.fieldName,
                                                        label: field.fieldName,
                                                    })
                                                ),
                                            ]}
                                        />
                                    ) : (
                                        <Field
                                            className="db-select-nw Table-cell--width--maximized"
                                            component={RenderSelect}
                                            name={`${field}.filterCriteria`}
                                            id={`${field}.filterCriteria`}
                                            placeholder="Criteria"
                                            style={{
                                                height: '28px',
                                                width: '100%',
                                            }}
                                            options={[
                                                {
                                                    value: 'incidentId',
                                                    label: 'Incident ID',
                                                },
                                                ...customFields.map(field => ({
                                                    value: field.fieldName,
                                                    label: field.fieldName,
                                                })),
                                            ]}
                                        />
                                    )}

                                    {formValues &&
                                    formValues.nextAction ===
                                        'createIncident' ? (
                                        (formValues.filters[index]
                                            ? (
                                                  monitorCustomFields.find(
                                                      field =>
                                                          field.fieldName ===
                                                          formValues.filters[
                                                              index
                                                          ].filterCriteria
                                                  ) || {
                                                      fieldType: 'text',
                                                  }
                                              ).fieldType
                                            : 'text') === 'text' ? (
                                            <Field
                                                className="db-select-nw Table-cell--width--maximized"
                                                component={RenderSelect}
                                                name={`${field}.filterCondition`}
                                                id={`${field}.filterCondition`}
                                                placeholder="Condition"
                                                style={{
                                                    height: '28px',
                                                    width: '100%',
                                                    marginLeft: 5,
                                                }}
                                                options={[
                                                    {
                                                        value: 'equalTo',
                                                        label: 'Equal To',
                                                    },
                                                    {
                                                        value: 'notEqualTo',
                                                        label: 'Not Equal To',
                                                    },
                                                ]}
                                            />
                                        ) : (
                                            <Field
                                                className="db-select-nw Table-cell--width--maximized"
                                                component={RenderSelect}
                                                name={`${field}.filterCondition`}
                                                id={`${field}.filterCondition`}
                                                placeholder="Condition"
                                                style={{
                                                    height: '28px',
                                                    width: '100%',
                                                    marginLeft: 5,
                                                }}
                                                options={[
                                                    {
                                                        value: 'equalTo',
                                                        label: 'Equal To',
                                                    },
                                                    {
                                                        value: 'notEqualTo',
                                                        label: 'Not Equal To',
                                                    },
                                                    {
                                                        value: 'greaterThan',
                                                        label: 'Greater Than',
                                                    },
                                                    {
                                                        value: 'lessThan',
                                                        label: 'Less Than',
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
                                        )
                                    ) : (formValues && formValues.filters[index]
                                          ? formValues.filters[index]
                                                .filterCriteria === 'incidentId'
                                              ? 'number'
                                              : (
                                                    customFields.find(
                                                        field =>
                                                            field.fieldName ===
                                                            formValues.filters[
                                                                index
                                                            ].filterCriteria
                                                    ) || {
                                                        fieldType: 'text',
                                                    }
                                                ).fieldType
                                          : 'text') === 'text' ? (
                                        <Field
                                            className="db-select-nw Table-cell--width--maximized"
                                            component={RenderSelect}
                                            name={`${field}.filterCondition`}
                                            id={`${field}.filterCondition`}
                                            placeholder="Condition"
                                            style={{
                                                height: '28px',
                                                width: '100%',
                                                marginLeft: 5,
                                            }}
                                            options={[
                                                {
                                                    value: 'equalTo',
                                                    label: 'Equal To',
                                                },
                                                {
                                                    value: 'notEqualTo',
                                                    label: 'Not Equal To',
                                                },
                                            ]}
                                        />
                                    ) : (
                                        <Field
                                            className="db-select-nw Table-cell--width--maximized"
                                            component={RenderSelect}
                                            name={`${field}.filterCondition`}
                                            id={`${field}.filterCondition`}
                                            placeholder="Condition"
                                            style={{
                                                height: '28px',
                                                width: '100%',
                                                marginLeft: 5,
                                            }}
                                            options={[
                                                {
                                                    value: 'equalTo',
                                                    label: 'Equal To',
                                                },
                                                {
                                                    value: 'notEqualTo',
                                                    label: 'Not Equal To',
                                                },
                                                {
                                                    value: 'greaterThan',
                                                    label: 'Greater Than',
                                                },
                                                {
                                                    value: 'lessThan',
                                                    label: 'Less Than',
                                                },
                                                {
                                                    value: 'lessThanOrEqualTo',
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
                                    )}

                                    {formValues &&
                                    formValues.nextAction ===
                                        'createIncident' ? (
                                        <Field
                                            component={RenderField}
                                            name={`${field}.filterText`}
                                            type={
                                                formValues &&
                                                formValues.filters[index]
                                                    ? (
                                                          monitorCustomFields.find(
                                                              field =>
                                                                  field.fieldName ===
                                                                  formValues
                                                                      .filters[
                                                                      index
                                                                  ]
                                                                      .filterCriteria
                                                          ) || {
                                                              fieldType: 'text',
                                                          }
                                                      ).fieldType
                                                    : 'text'
                                            }
                                            placeholder="{{request.body.value}}"
                                            id={`${field}.filterText`}
                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                            style={{
                                                width: '100%',
                                                padding: '3px 5px',
                                                marginLeft: 5,
                                            }}
                                            parentStyle={{
                                                marginRight: 5,
                                            }}
                                        />
                                    ) : (
                                        <Field
                                            component={RenderField}
                                            name={`${field}.filterText`}
                                            type={
                                                formValues &&
                                                formValues.filters[index]
                                                    ? formValues.filters[index]
                                                          .filterCriteria ===
                                                      'incidentId'
                                                        ? 'number'
                                                        : (
                                                              customFields.find(
                                                                  field =>
                                                                      field.fieldName ===
                                                                      formValues
                                                                          .filters[
                                                                          index
                                                                      ]
                                                                          .filterCriteria
                                                              ) || {
                                                                  fieldType:
                                                                      'text',
                                                              }
                                                          ).fieldType
                                                    : 'text'
                                            }
                                            placeholder="{{request.body.value}}"
                                            id={`${field}.filterText`}
                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                            style={{
                                                width: '100%',
                                                padding: '3px 5px',
                                                marginLeft: 5,
                                            }}
                                            parentStyle={{
                                                marginRight: 5,
                                            }}
                                        />
                                    )}
                                    <Tooltip title="Incoming http Request Filter">
                                        <p>
                                            Filter exposes the{' '}
                                            <code>request</code> object of an
                                            incoming request. The value on the{' '}
                                            <code>request</code> object can
                                            either be a string or a number
                                        </p>
                                        <p>
                                            Example properties include the
                                            following:
                                        </p>
                                        <p>
                                            <ul>
                                                <li>
                                                    <code>request.body</code>
                                                </li>
                                                <li>
                                                    <code>request.query</code>
                                                </li>
                                                <li>
                                                    <code>request.headers</code>
                                                </li>
                                            </ul>
                                        </p>
                                        <p>Usage examples include:</p>
                                        <p>
                                            <ul>
                                                <li>
                                                    <code>
                                                        1 | request.body.value
                                                    </code>
                                                </li>
                                                <li>
                                                    <code>
                                                        2 | request.query.value
                                                    </code>
                                                </li>
                                                <li>
                                                    <code>
                                                        3 | request.header.value
                                                    </code>
                                                </li>
                                            </ul>
                                        </p>
                                        <p>
                                            You can pass the value of{' '}
                                            <code>request</code> object directly
                                            or you can specify the{' '}
                                            <code>request</code> body as a
                                            variable{' '}
                                            <code>
                                                {'{{request.body.value}}'}
                                            </code>
                                        </p>
                                    </Tooltip>
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={() => fields.remove(index)}
                                        style={{
                                            borderRadius: '50%',
                                            padding: 0,
                                            display: 'flex',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                            width: 25,
                                            height: 25,
                                        }}
                                    >
                                        <img
                                            src="/dashboard/assets/img/minus.svg"
                                            style={{
                                                height: '13px',
                                                width: '13px',
                                            }}
                                            alt=""
                                        />
                                    </button>
                                </div>
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
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                if (e.target.localName !== 'textarea') {
                    return document
                        .getElementById('editIncomingRequest')
                        .click();
                }
                break;
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        this.props.destroy();
        this.props.closeModal({
            id: this.props.projectId,
        });
    };

    toggleShowAdvancedOptions = () =>
        this.props.change(
            'showAdvancedOptions',
            !this.props.formValues.showAdvancedOptions
        );

    toggleShowAvailableVariables = () =>
        this.props.change(
            'showAvailableVariables',
            !this.props.formValues.showAvailableVariables
        );

    onContentChange = val => {
        this.props.change('noteContent', val);
    };

    render() {
        const {
            handleSubmit,
            projectId,
            formValues,
            closeModal,
            incidentPriorities,
            destroy,
            customFields,
        } = this.props;

        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 700 }}>
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
                                        <span>Edit Incoming HTTP Request</span>
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
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span>Name</span>
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
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="name"
                                                                type="input"
                                                                placeholder="Name of request"
                                                                id="name"
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
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

                                        <fieldset style={{ paddingTop: 0 }}>
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
                                                    ></label>
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
                                                                fontWeight: 500,
                                                            }}
                                                        >
                                                            What would you like
                                                            to do
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <fieldset>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="createIncident"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                                htmlFor="createIncident"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="nextAction"
                                                                    className="bs-Radio-source"
                                                                    id="createIncident"
                                                                    value="createIncident"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
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

                                        <fieldset>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="acknowledgeIncident"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                                htmlFor="acknowledgeIncident"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="nextAction"
                                                                    className="bs-Radio-source"
                                                                    id="acknowledgeIncident"
                                                                    value="acknowledgeIncident"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Acknowledge
                                                                        Incident
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <fieldset>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="resolveIncident"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                                htmlFor="resolveIncident"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="nextAction"
                                                                    className="bs-Radio-source"
                                                                    id="resolveIncident"
                                                                    value="resolveIncident"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Resolve
                                                                        Incident
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <fieldset>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="updateIncidentNote"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                                htmlFor="updateIncidentNote"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="nextAction"
                                                                    className="bs-Radio-source"
                                                                    id="updateIncidentNote"
                                                                    value="updateIncidentNote"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Update
                                                                        Incident
                                                                        Note
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
                                                        htmlFor="updateInternalNote"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                                htmlFor="updateInternalNote"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="nextAction"
                                                                    className="bs-Radio-source"
                                                                    id="updateInternalNote"
                                                                    value="updateInternalNote"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Update
                                                                        Internal
                                                                        Note
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        {formValues &&
                                            !formValues.isDefault &&
                                            formValues.nextAction ===
                                                'createIncident' && (
                                                <fieldset className="Margin-bottom--16">
                                                    <div className="bs-Fieldset-rows">
                                                        <div
                                                            className="bs-Fieldset-row"
                                                            style={{
                                                                padding: 0,
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                style={{
                                                                    flexBasis:
                                                                        '20%',
                                                                }}
                                                            >
                                                                <span>
                                                                    Monitors
                                                                </span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-fields"
                                                                style={{
                                                                    flexBasis:
                                                                        '80%',
                                                                    maxWidth:
                                                                        '80%',
                                                                }}
                                                            >
                                                                <div
                                                                    className="bs-Fieldset-field"
                                                                    style={{
                                                                        width:
                                                                            '100%',
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

                                        {formValues &&
                                            formValues.nextAction ===
                                                'createIncident' && (
                                                <fieldset className="Margin-bottom--16">
                                                    <div className="bs-Fieldset-rows">
                                                        <div
                                                            className="bs-Fieldset-row"
                                                            style={{
                                                                padding: 0,
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                htmlFor="isDefault"
                                                                style={{
                                                                    flexBasis:
                                                                        '20%',
                                                                }}
                                                            >
                                                                <span></span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-fields"
                                                                style={{
                                                                    paddingTop:
                                                                        '6px',
                                                                    flexBasis:
                                                                        '80%',
                                                                    maxWidth:
                                                                        '80%',
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
                                                                                Use
                                                                                as
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
                                            )}

                                        <fieldset style={{ paddingTop: 0 }}>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="showAdvancedOptions"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    ></label>
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
                                                                padding:
                                                                    '10px 0px',
                                                                textDecoration:
                                                                    'underline',
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    cursor:
                                                                        'pointer',
                                                                }}
                                                                onClick={
                                                                    this
                                                                        .toggleShowAdvancedOptions
                                                                }
                                                            >
                                                                {formValues &&
                                                                formValues.showAdvancedOptions
                                                                    ? 'Hide advanced options'
                                                                    : 'Show advanced options'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        {formValues &&
                                            formValues.showAdvancedOptions &&
                                            (formValues.nextAction ===
                                                'acknowledgeIncident' ||
                                                formValues.nextAction ===
                                                    'resolveIncident') && (
                                                <fieldset className="Margin-bottom--16">
                                                    <div className="bs-Fieldset-rows">
                                                        <div
                                                            className="bs-Fieldset-row"
                                                            style={{
                                                                padding: 0,
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                style={{
                                                                    flexBasis:
                                                                        '20%',
                                                                }}
                                                            >
                                                                <span>
                                                                    Filters
                                                                </span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-fields"
                                                                style={{
                                                                    flexBasis:
                                                                        '80%',
                                                                    maxWidth:
                                                                        '80%',
                                                                }}
                                                            >
                                                                <div
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                        marginBottom: 20,
                                                                    }}
                                                                >
                                                                    <div>
                                                                        Match
                                                                    </div>
                                                                    <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                                                        <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--center">
                                                                            <Field
                                                                                className="db-select-nw Table-cell--width--maximized"
                                                                                component={
                                                                                    RenderSelect
                                                                                }
                                                                                name="filterMatch"
                                                                                id="filterMatch"
                                                                                style={{
                                                                                    height:
                                                                                        '28px',
                                                                                    maxWidth: 150,
                                                                                }}
                                                                                options={[
                                                                                    {
                                                                                        value:
                                                                                            'all',
                                                                                        label:
                                                                                            'All',
                                                                                    },
                                                                                    {
                                                                                        value:
                                                                                            'any',
                                                                                        label:
                                                                                            'Any',
                                                                                    },
                                                                                ]}
                                                                            />
                                                                            <span
                                                                                style={{
                                                                                    marginLeft: 10,
                                                                                }}
                                                                            >
                                                                                of
                                                                                the
                                                                                following
                                                                                rules:
                                                                            </span>
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={e => {
                                                                                e.preventDefault();
                                                                                document
                                                                                    .querySelector(
                                                                                        '#addFilter'
                                                                                    )
                                                                                    .click();
                                                                            }}
                                                                            className="Button bs-ButtonLegacy ActionIconParent"
                                                                        >
                                                                            <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                                <span>
                                                                                    Add
                                                                                    filter
                                                                                </span>
                                                                            </span>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '100%',
                                                                        maxWidth:
                                                                            '100%',
                                                                        width:
                                                                            '100%',
                                                                        padding: 0,
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <FieldArray
                                                                            name="filters"
                                                                            component={
                                                                                this
                                                                                    .renderFilters
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            )}

                                        {formValues &&
                                            formValues.showAdvancedOptions &&
                                            (formValues.nextAction ===
                                                'updateInternalNote' ||
                                                formValues.nextAction ===
                                                    'updateIncidentNote') && (
                                                <>
                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Filters
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                            marginBottom: 20,
                                                                        }}
                                                                    >
                                                                        <div>
                                                                            Match
                                                                        </div>
                                                                        <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                                                            <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--center">
                                                                                <Field
                                                                                    className="db-select-nw Table-cell--width--maximized"
                                                                                    component={
                                                                                        RenderSelect
                                                                                    }
                                                                                    name="filterMatch"
                                                                                    id="filterMatch"
                                                                                    style={{
                                                                                        height:
                                                                                            '28px',
                                                                                        maxWidth: 150,
                                                                                    }}
                                                                                    options={[
                                                                                        {
                                                                                            value:
                                                                                                'all',
                                                                                            label:
                                                                                                'All',
                                                                                        },
                                                                                        {
                                                                                            value:
                                                                                                'any',
                                                                                            label:
                                                                                                'Any',
                                                                                        },
                                                                                    ]}
                                                                                />
                                                                                <span
                                                                                    style={{
                                                                                        marginLeft: 10,
                                                                                    }}
                                                                                >
                                                                                    of
                                                                                    the
                                                                                    following
                                                                                    rules:
                                                                                </span>
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                onClick={e => {
                                                                                    e.preventDefault();
                                                                                    document
                                                                                        .querySelector(
                                                                                            '#addFilter'
                                                                                        )
                                                                                        .click();
                                                                                }}
                                                                                className="Button bs-ButtonLegacy ActionIconParent"
                                                                            >
                                                                                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                                    <span>
                                                                                        Add
                                                                                        filter
                                                                                    </span>
                                                                                </span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="bs-Fieldset-fields"
                                                                        style={{
                                                                            flexBasis:
                                                                                '100%',
                                                                            maxWidth:
                                                                                '100%',
                                                                            width:
                                                                                '100%',
                                                                            padding: 0,
                                                                        }}
                                                                    >
                                                                        <div
                                                                            className="bs-Fieldset-field"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        >
                                                                            <FieldArray
                                                                                name="filters"
                                                                                component={
                                                                                    this
                                                                                        .renderFilters
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>

                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="incidentState"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Incident
                                                                        State
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <Field
                                                                            className="db-select-nw-300"
                                                                            component={
                                                                                RenderSelect
                                                                            }
                                                                            name="incidentState"
                                                                            id="incidentState"
                                                                            placeholder="Incident State"
                                                                            disabled={
                                                                                false
                                                                            }
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                            options={[
                                                                                {
                                                                                    value:
                                                                                        'investigating',
                                                                                    label:
                                                                                        'Investigating',
                                                                                },
                                                                                {
                                                                                    value:
                                                                                        'update',
                                                                                    label:
                                                                                        'Update',
                                                                                },
                                                                                {
                                                                                    value:
                                                                                        'others',
                                                                                    label:
                                                                                        'Others',
                                                                                },
                                                                            ]}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>

                                                    {formValues &&
                                                        formValues.incidentState ===
                                                            'others' && (
                                                            <fieldset className="Margin-bottom--16">
                                                                <div className="bs-Fieldset-rows">
                                                                    <div
                                                                        className="bs-Fieldset-row"
                                                                        style={{
                                                                            padding: 0,
                                                                        }}
                                                                    >
                                                                        <label
                                                                            className="bs-Fieldset-label Text-align--left"
                                                                            htmlFor="customIncidentState"
                                                                            style={{
                                                                                flexBasis:
                                                                                    '20%',
                                                                            }}
                                                                        >
                                                                            <span>
                                                                                Custom
                                                                                Incident
                                                                                State
                                                                            </span>
                                                                        </label>
                                                                        <div
                                                                            className="bs-Fieldset-fields"
                                                                            style={{
                                                                                flexBasis:
                                                                                    '80%',
                                                                                maxWidth:
                                                                                    '80%',
                                                                            }}
                                                                        >
                                                                            <div
                                                                                className="bs-Fieldset-field"
                                                                                style={{
                                                                                    width:
                                                                                        '100%',
                                                                                }}
                                                                            >
                                                                                <Field
                                                                                    className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                                    component={
                                                                                        RenderField
                                                                                    }
                                                                                    type="text"
                                                                                    name={`customIncidentState`}
                                                                                    id="customIncidentState"
                                                                                    placeholder="Enter a custom incident state"
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                    }}
                                                                                    required={
                                                                                        true
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
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="noteContent"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Investigation
                                                                        Note
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <CodeEditor
                                                                            code={
                                                                                formValues.noteContent ||
                                                                                ''
                                                                            }
                                                                            onCodeChange={
                                                                                this
                                                                                    .onContentChange
                                                                            }
                                                                            textareaId="newNoteContent"
                                                                            placeholder="This can be markdown"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                            required={
                                                                                true
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                </>
                                            )}

                                        {formValues &&
                                            formValues.showAdvancedOptions &&
                                            formValues.nextAction ===
                                                'createIncident' && (
                                                <>
                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Filters
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                            marginBottom: 20,
                                                                        }}
                                                                    >
                                                                        <div>
                                                                            Match
                                                                        </div>
                                                                        <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                                                            <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--center">
                                                                                <Field
                                                                                    className="db-select-nw Table-cell--width--maximized"
                                                                                    component={
                                                                                        RenderSelect
                                                                                    }
                                                                                    name="filterMatch"
                                                                                    id="filterMatch"
                                                                                    style={{
                                                                                        height:
                                                                                            '28px',
                                                                                        maxWidth: 150,
                                                                                    }}
                                                                                    options={[
                                                                                        {
                                                                                            value:
                                                                                                'all',
                                                                                            label:
                                                                                                'All',
                                                                                        },
                                                                                        {
                                                                                            value:
                                                                                                'any',
                                                                                            label:
                                                                                                'Any',
                                                                                        },
                                                                                    ]}
                                                                                />
                                                                                <span
                                                                                    style={{
                                                                                        marginLeft: 10,
                                                                                    }}
                                                                                >
                                                                                    of
                                                                                    the
                                                                                    following
                                                                                    rules:
                                                                                </span>
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                onClick={e => {
                                                                                    e.preventDefault();
                                                                                    document
                                                                                        .querySelector(
                                                                                            '#addFilter'
                                                                                        )
                                                                                        .click();
                                                                                }}
                                                                                className="Button bs-ButtonLegacy ActionIconParent"
                                                                            >
                                                                                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                                    <span>
                                                                                        Add
                                                                                        filter
                                                                                    </span>
                                                                                </span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="bs-Fieldset-fields"
                                                                        style={{
                                                                            flexBasis:
                                                                                '100%',
                                                                            maxWidth:
                                                                                '100%',
                                                                            width:
                                                                                '100%',
                                                                            padding: 0,
                                                                        }}
                                                                    >
                                                                        <div
                                                                            className="bs-Fieldset-field"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        >
                                                                            <FieldArray
                                                                                name="filters"
                                                                                component={
                                                                                    this
                                                                                        .renderFilters
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    <fieldset>
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="name"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                ></label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <div
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                                paddingBottom: 10,
                                                                                fontWeight: 500,
                                                                                fontSize: 14,
                                                                            }}
                                                                        >
                                                                            Incidents
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="incidentTitle"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Incident
                                                                        Title
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <Field
                                                                            component={
                                                                                RenderField
                                                                            }
                                                                            name="incidentTitle"
                                                                            type="input"
                                                                            placeholder="Monitor is offline"
                                                                            id="incidentTitle"
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
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
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="incidentType"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Incident
                                                                        Type
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        {formValues &&
                                                                        !formValues.dynamicIncidentType ? (
                                                                            <Field
                                                                                className="db-select-nw"
                                                                                component={
                                                                                    RenderSelect
                                                                                }
                                                                                name="incidentType"
                                                                                id="incidentType"
                                                                                placeholder="Incident type"
                                                                                disabled={
                                                                                    this
                                                                                        .props
                                                                                        .requesting
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
                                                                            />
                                                                        ) : (
                                                                            <Field
                                                                                className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                                component={
                                                                                    RenderField
                                                                                }
                                                                                type="text"
                                                                                name="customIncidentType"
                                                                                id="incidentType"
                                                                                placeholder="Incident Type"
                                                                                style={{
                                                                                    width:
                                                                                        '100%',
                                                                                }}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                    <div
                                                                        onClick={() =>
                                                                            this.props.change(
                                                                                'dynamicIncidentType',
                                                                                !formValues.dynamicIncidentType
                                                                            )
                                                                        }
                                                                        style={{
                                                                            cursor:
                                                                                'pointer',
                                                                            marginTop: 5,
                                                                            textDecoration:
                                                                                'underline',
                                                                        }}
                                                                    >
                                                                        {formValues.dynamicIncidentType
                                                                            ? 'use predefined values'
                                                                            : 'use dynamic values'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    <ShouldRender
                                                        if={
                                                            incidentPriorities.length >
                                                            0
                                                        }
                                                    >
                                                        <fieldset className="Margin-bottom--16">
                                                            <div className="bs-Fieldset-rows">
                                                                <div
                                                                    className="bs-Fieldset-row"
                                                                    style={{
                                                                        padding: 0,
                                                                    }}
                                                                >
                                                                    <label
                                                                        className="bs-Fieldset-label Text-align--left"
                                                                        htmlFor="incidentPriority"
                                                                        style={{
                                                                            flexBasis:
                                                                                '20%',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Incident
                                                                            Priority
                                                                        </span>
                                                                    </label>
                                                                    <div
                                                                        className="bs-Fieldset-fields"
                                                                        style={{
                                                                            flexBasis:
                                                                                '80%',
                                                                            maxWidth:
                                                                                '80%',
                                                                        }}
                                                                    >
                                                                        <div
                                                                            className="bs-Fieldset-field"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        >
                                                                            {formValues &&
                                                                            !formValues.dynamicIncidentPriority ? (
                                                                                <Field
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                    }}
                                                                                    className="db-select-nw"
                                                                                    component={
                                                                                        RenderSelect
                                                                                    }
                                                                                    name="incidentPriority"
                                                                                    id="incidentPriority"
                                                                                    disabled={
                                                                                        this
                                                                                            .props
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
                                                                                />
                                                                            ) : (
                                                                                <Field
                                                                                    className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                                    component={
                                                                                        RenderField
                                                                                    }
                                                                                    type="text"
                                                                                    name="customIncidentPriority"
                                                                                    id="incidentPriority"
                                                                                    placeholder="Incident Priority"
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                        <div
                                                                            onClick={() =>
                                                                                this.props.change(
                                                                                    'dynamicIncidentPriority',
                                                                                    !formValues.dynamicIncidentPriority
                                                                                )
                                                                            }
                                                                            style={{
                                                                                cursor:
                                                                                    'pointer',
                                                                                marginTop: 5,
                                                                                textDecoration:
                                                                                    'underline',
                                                                            }}
                                                                        >
                                                                            {formValues.dynamicIncidentPriority
                                                                                ? 'use predefined values'
                                                                                : 'use dynamic values'}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </fieldset>
                                                    </ShouldRender>
                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="incidentDescription"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Incident
                                                                        Description
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <Field
                                                                            component={
                                                                                RenderTextArea
                                                                            }
                                                                            name="incidentDescription"
                                                                            type="text"
                                                                            rows="5"
                                                                            placeholder="Description of the incident"
                                                                            id="incidentDescription"
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                                padding:
                                                                                    '3px 5px',
                                                                                whiteSpace:
                                                                                    'normal',
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    {customFields &&
                                                        customFields.length >
                                                            0 &&
                                                        customFields.map(
                                                            (field, index) => (
                                                                <fieldset
                                                                    key={index}
                                                                    className="Margin-bottom--16"
                                                                >
                                                                    <div className="bs-Fieldset-rows">
                                                                        <div
                                                                            className="bs-Fieldset-row"
                                                                            style={{
                                                                                padding: 0,
                                                                            }}
                                                                        >
                                                                            <label
                                                                                className="bs-Fieldset-label Text-align--left"
                                                                                htmlFor="incidentDescription"
                                                                                style={{
                                                                                    flexBasis:
                                                                                        '20%',
                                                                                }}
                                                                            >
                                                                                <span>
                                                                                    {
                                                                                        field.fieldName
                                                                                    }
                                                                                </span>
                                                                            </label>
                                                                            <div
                                                                                className="bs-Fieldset-fields"
                                                                                style={{
                                                                                    flexBasis:
                                                                                        '80%',
                                                                                    maxWidth:
                                                                                        '80%',
                                                                                }}
                                                                            >
                                                                                <div
                                                                                    className="bs-Fieldset-field"
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                    }}
                                                                                >
                                                                                    <Field
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
                                                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                                        style={{
                                                                                            width:
                                                                                                '100%',
                                                                                            padding:
                                                                                                '3px 5px',
                                                                                            whiteSpace:
                                                                                                'normal',
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </fieldset>
                                                            )
                                                        )}
                                                    <fieldset
                                                        style={{
                                                            paddingTop: 0,
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="name"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                ></label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                            display:
                                                                                'block',
                                                                        }}
                                                                    >
                                                                        {formValues &&
                                                                            !formValues.showAvailableVariables && (
                                                                                <div
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                        paddingBottom: 10,
                                                                                        textDecoration:
                                                                                            'underline',
                                                                                        cursor:
                                                                                            'pointer',
                                                                                    }}
                                                                                    onClick={
                                                                                        this
                                                                                            .toggleShowAvailableVariables
                                                                                    }
                                                                                >
                                                                                    Click
                                                                                    to
                                                                                    show
                                                                                    available
                                                                                    variables
                                                                                </div>
                                                                            )}
                                                                        {formValues &&
                                                                            formValues.showAvailableVariables && (
                                                                                <div>
                                                                                    <span
                                                                                        className="template-variable-2"
                                                                                        style={{
                                                                                            display:
                                                                                                'block',
                                                                                            paddingBottom:
                                                                                                '10px',
                                                                                        }}
                                                                                    >
                                                                                        You
                                                                                        can
                                                                                        use
                                                                                        these
                                                                                        available
                                                                                        variables
                                                                                        in
                                                                                        incident
                                                                                        title,
                                                                                        incident
                                                                                        description
                                                                                        or
                                                                                        custom
                                                                                        field.
                                                                                    </span>
                                                                                    <span
                                                                                        className="template-variable-1"
                                                                                        style={{
                                                                                            display:
                                                                                                'block',
                                                                                        }}
                                                                                    >
                                                                                        {incomingRequestVariables.map(
                                                                                            (
                                                                                                item,
                                                                                                index
                                                                                            ) => {
                                                                                                return (
                                                                                                    <span
                                                                                                        key={
                                                                                                            index
                                                                                                        }
                                                                                                        className="template-variables"
                                                                                                        style={
                                                                                                            bulletpoints
                                                                                                        }
                                                                                                    >
                                                                                                        {
                                                                                                            item.description
                                                                                                        }
                                                                                                        <br />
                                                                                                    </span>
                                                                                                );
                                                                                            }
                                                                                        )}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                </>
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
                                            onClick={() => {
                                                destroy();
                                                closeModal({ id: projectId });
                                            }}
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
                        </ClickOutside>
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
    incidentPriorities: PropTypes.func,
    change: PropTypes.func.isRequired, // to manually change value of redux form state
    destroy: PropTypes.func.isRequired, // to manually destroy the redux form state
    customFields: PropTypes.array,
    fetchCustomFields: PropTypes.func,
    fetchMonitorCustomFields: PropTypes.func,
    monitorCustomFields: PropTypes.array,
};

const EditIncomingRequestForm = reduxForm({
    form: 'editIncomingRequestForm', // a unique identifier for this form
    enableReinitialize: false,
    validate, // <--- validation function given to redux-form
    destroyOnUnmount: false,
})(EditIncomingRequest);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            editIncomingRequest,
            closeModal,
            fetchCustomFields,
            fetchMonitorCustomFields,
        },
        dispatch
    );

const mapStateToProps = state => {
    const incomingRequestToBeUpdated = state.modal.modals[0].incomingRequest;
    const projectId = state.modal.modals[0].projectId;
    const incidentPriorities =
        state.incidentPriorities.incidentPrioritiesList.incidentPriorities;

    const initialValues = {};

    if (incomingRequestToBeUpdated) {
        initialValues.name = incomingRequestToBeUpdated.name;
        initialValues.isDefault = incomingRequestToBeUpdated.isDefault;
        initialValues.createIncident =
            incomingRequestToBeUpdated.createIncident;
        if (incomingRequestToBeUpdated.createIncident) {
            initialValues.nextAction = 'createIncident';
        }
        if (incomingRequestToBeUpdated.updateIncidentNote) {
            initialValues.nextAction = 'updateIncidentNote';
        }
        if (incomingRequestToBeUpdated.updateInternalNote) {
            initialValues.nextAction = 'updateInternalNote';
        }
        if (
            incomingRequestToBeUpdated.updateIncidentNote ||
            incomingRequestToBeUpdated.updateInternalNote
        ) {
            initialValues.incidentState = ['update', 'investigating'].includes(
                incomingRequestToBeUpdated.incidentState
            )
                ? incomingRequestToBeUpdated.incidentState
                : 'others';
            initialValues.customIncidentState = ![
                'update',
                'investigating',
            ].includes(incomingRequestToBeUpdated.incidentState)
                ? incomingRequestToBeUpdated.incidentState
                : '';
            initialValues.noteContent =
                incomingRequestToBeUpdated.noteContent || '';
        }
        if (incomingRequestToBeUpdated.acknowledgeIncident) {
            initialValues.nextAction = 'acknowledgeIncident';
        }
        if (incomingRequestToBeUpdated.resolveIncident) {
            initialValues.nextAction = 'resolveIncident';
        }
        initialValues._id = incomingRequestToBeUpdated._id;

        initialValues.filters = incomingRequestToBeUpdated.filters;
        initialValues.filterMatch = incomingRequestToBeUpdated.filterMatch;

        if (incomingRequestToBeUpdated.createIncident) {
            const priorityIds = incidentPriorities.map(priority =>
                String(priority._id)
            );
            initialValues.dynamicIncidentPriority = !priorityIds.includes(
                incomingRequestToBeUpdated.incidentPriority
            );

            if (initialValues.dynamicIncidentPriority) {
                initialValues.customIncidentPriority =
                    incomingRequestToBeUpdated.incidentPriority;
            }
        }
        if (!initialValues.dynamicIncidentPriority) {
            initialValues.incidentPriority =
                incomingRequestToBeUpdated.incidentPriority;
        }
        initialValues.incidentTitle = incomingRequestToBeUpdated.incidentTitle;
        if (incomingRequestToBeUpdated.createIncident) {
            initialValues.dynamicIncidentType = ![
                'offline',
                'online',
                'degraded',
            ].includes(incomingRequestToBeUpdated.incidentType);

            if (initialValues.dynamicIncidentType) {
                initialValues.customIncidentType =
                    incomingRequestToBeUpdated.incidentType;
            }
        }
        if (!initialValues.dynamicIncidentType) {
            initialValues.incidentType =
                incomingRequestToBeUpdated.incidentType;
        }
        initialValues.incidentDescription =
            incomingRequestToBeUpdated.incidentDescription;
        if (
            incomingRequestToBeUpdated.customFields &&
            incomingRequestToBeUpdated.customFields.length > 0
        ) {
            incomingRequestToBeUpdated.customFields.forEach(
                field => (initialValues[field.fieldName] = field.fieldValue)
            );
        }
        initialValues.showAdvancedOptions = false;
        initialValues.showAvailableVariables = false;
    }

    let monitors = [];
    state.monitor.monitorsList.monitors.forEach(monitor => {
        monitors = [...monitors, ...monitor.monitors];
    });
    if (!initialValues.isDefault) {
        initialValues.monitors =
            incomingRequestToBeUpdated.monitors &&
            incomingRequestToBeUpdated.monitors.map(
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
        incidentPriorities,
        customFields: state.customField.customFields.fields,
        monitorCustomFields:
            state.monitorCustomField.monitorCustomFields.fields,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditIncomingRequestForm);
