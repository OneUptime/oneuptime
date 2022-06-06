import React from 'react';
import PropTypes from 'prop-types';
import { RenderSelect } from '../../basic/RenderSelect';

import { reduxForm, Field } from 'redux-form';
import { connect } from 'react-redux';
import { Validate } from '../../../config';
import {
    addSsoDefaultRole,
    updateSsoDefaultRole,
    fetchSsoDefaultRoles,
} from '../../../actions/ssoDefaultRoles';

/**
 * Domain
 * project
 * Role
 */
const fields: $TSFixMe = [
    {
        key: 'domain',
        label: 'Domain',
        placeholder: 'Select a domain',
        component: RenderSelect,
    },
    {
        key: 'project',
        label: 'Project',
        placeholder: 'Select a project',
        component: RenderSelect,
    },
    {
        key: 'role',
        label: 'Role',
        placeholder: 'Select a role',
        component: RenderSelect,
    },
];

// Client side validation
function validate(values: $TSFixMe) {
    const errors: $TSFixMe = {};

    if (!Validate.text(values.domain)) {
        errors.domain = 'Domain is required.';
    }

    if (!Validate.text(values.project)) {
        errors.project = 'Project is required.';
    }

    if (!Validate.text(values.role)) {
        errors.role = 'Role is required.';
    }

    return errors;
}

const Form: Function = ({
    formTitle,
    onSubmit,
    ssos,
    projects,
    errorMessage,
    handleSubmit,
    fetchSsoDefaultRoles,
    closeThisDialog,
}: $TSFixMe) => {
    const optionsArray: $TSFixMe = [
        ssos.map((sso: $TSFixMe) => {
            return {
                value: sso._id,
                label: sso.domain,
            };
        }),
        projects.map((project: $TSFixMe) => {
            return {
                value: project._id,
                label: project.name,
            };
        }),
        [
            { value: 'Administrator', label: 'Administrator' },
            { value: 'Member', label: 'Member' },
            { value: 'Viewer', label: 'Viewer' },
        ],
    ];
    const submitForm: Function = async (data: $TSFixMe) => {
        const { _id: id } = data;
        const success: $TSFixMe = await onSubmit({ id, data });
        if (!success) {
            return;
        }
        fetchSsoDefaultRoles();
        closeThisDialog();
    };
    return (
        <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-Modal-header">
                    <div
                        className="bs-Modal-header-copy"
                        style={{
                            marginBottom: '10px',
                            marginTop: '10px',
                        }}
                    >
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                            <span>{formTitle}</span>
                        </span>
                    </div>
                </div>
                <form onSubmit={handleSubmit(submitForm)}>
                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <fieldset className="bs-Fieldset">
                                    <div className="bs-Fieldset-rows">
                                        {fields.map((field, index) => {
                                            return (
                                                <div
                                                    key={field.key}
                                                    className="bs-Fieldset-row"
                                                >
                                                    <label className="bs-Fieldset-label">
                                                        {field.label}
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: 3,
                                                        }}
                                                    >
                                                        <Field
                                                            className="db-select-nw"
                                                            name={field.key}
                                                            id={field.key}
                                                            placeholder={
                                                                field.placeholder
                                                            }
                                                            component={
                                                                field.component
                                                            }
                                                            /*
                                                             * disabled={
                                                             *   sso &&
                                                             *   sso.requesting
                                                             * }
                                                             */
                                                            style={{
                                                                width: '350px',
                                                            }}
                                                            autoFocus={
                                                                field.key ===
                                                                'domain'
                                                                    ? true
                                                                    : false
                                                            }
                                                            options={
                                                                optionsArray[
                                                                    index
                                                                ]
                                                            }
                                                            required
                                                        />
                                                        <span
                                                            style={{
                                                                marginTop:
                                                                    '10px',
                                                            }}
                                                        >
                                                            {field.description}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </fieldset>
                            </div>
                        </div>
                    </div>

                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        <span
                            className="db-SettingsForm-footerMessage"
                            style={{ color: 'red' }}
                        >
                            {errorMessage}
                        </span>
                        <div style={{ display: 'flex' }}>
                            <button
                                className="bs-Button bs-DeprecatedButton btn__modal"
                                type="button"
                                onClick={closeThisDialog}
                            >
                                <span>Cancel</span>
                                <span className="cancel-btn__keycode">Esc</span>
                            </button>
                            <button
                                id="save-button"
                                className="bs-Button bs-Button--blue btn__modal"
                                /*
                                 * disabled={updatingSso || addingSso}
                                 * type="submit"
                                 * autoFocus={formTitle === 'Update SSO'}
                                 */
                            >
                                <span>Save</span>
                                <span className="create-btn__keycode">
                                    <span className="keycode__icon keycode__icon--enter" />
                                </span>
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};
const ReduxConnectedForm: $TSFixMe = reduxForm({
    form: 'role-modal',
    enableReinitialize: true,
    validate,
})(Form);

Form.displayName = 'Form';

Form.propTypes = {
    formTitle: PropTypes.string,
    onSubmit: PropTypes.func,
    ssos: PropTypes.string,
    projects: PropTypes.string,
    errorMessage: PropTypes.string,
    handleSubmit: PropTypes.func,
    fetchSsoDefaultRoles: PropTypes.func,
    closeThisDialog: PropTypes.func.isRequired,
};

export const CreateDefaultRoleModal: $TSFixMe = connect(
    state => {
        return {
            formTitle: 'Create New Default Role',

            ssos: state.sso.ssos.ssos,

            projects: state.project.projects.projects,

            errorMessage: state.ssoDefaultRoles.addSsoDefaultRole.error,
        };
    },
    dispatch => {
        return {
            onSubmit: ({ data }: $TSFixMe) => {
                return dispatch(addSsoDefaultRole({ data }));
            },

            fetchSsoDefaultRoles: () => {
                return dispatch(fetchSsoDefaultRoles());
            },
        };
    }
)(ReduxConnectedForm);

export const UpdateDefaultRoleModal: $TSFixMe = connect(
    state => {
        const initialValues: $TSFixMe = {
            ...state.ssoDefaultRoles.ssoDefaultRole.ssoDefaultRole,

            ...(state.ssoDefaultRoles.ssoDefaultRole.ssoDefaultRole.domain
                ? {
                      domain: state.ssoDefaultRoles.ssoDefaultRole
                          .ssoDefaultRole.domain._id,
                  }
                : {
                      domain: null,
                  }),

            ...(state.ssoDefaultRoles.ssoDefaultRole.ssoDefaultRole.project
                ? {
                      project:
                          state.ssoDefaultRoles.ssoDefaultRole.ssoDefaultRole
                              .project._id,
                  }
                : {
                      project: null,
                  }),
        };
        return {
            initialValues,

            ssos: state.sso.ssos.ssos,

            projects: state.project.projects.projects,

            errorMessage: state.ssoDefaultRoles.updateSsoDefaultRole.error,
        };
    },
    dispatch => {
        return {
            onSubmit: ({ id, data }: $TSFixMe) => {
                return dispatch(updateSsoDefaultRole({ id, data }));
            },

            fetchSsoDefaultRoles: () => {
                return dispatch(fetchSsoDefaultRoles());
            },
        };
    }
)(ReduxConnectedForm);
