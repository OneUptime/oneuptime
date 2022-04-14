import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { reduxForm, Field } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { updateIncident } from '../../actions/incident';
import { ValidateField } from '../../config';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderField } from '../basic/RenderField';
import RenderCodeEditor from '../basic/RenderCodeEditor';

interface EditIncidentProps {
    incidentPriorities: unknown[];
}

class EditIncident extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':

                return document.getElementById('saveIncident').click();
            default:
                return false;
        }
    };

    submitForm = (values: $TSFixMe) => {

        const { incidentId } = this.props.data;

        const projectId = this.props.currentProject._id;
        this.props

            .updateIncident(
                projectId,
                incidentId,
                values.incidentType,
                values.title,
                values.description,
                values.incidentPriority === '' ? null : values.incidentPriority
            )

            .then(() => this.props.closeThisDialog());
    };

    override render() {
        const {

            handleSubmit,

            editIncident,

            incidentPriorities,

            closeThisDialog,
        } = this.props;
        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <ClickOutside onClickOutside={closeThisDialog}>
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
                                            Edit Incident
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
                                                            id="incidentPriority"
                                                            name="incidentPriority"
                                                            disabled={
                                                                this.props

                                                                    .editIncident
                                                                    .requesting
                                                            }
                                                            options={[
                                                                {
                                                                    value: '',
                                                                    label:
                                                                        'Incident Priority',
                                                                },
                                                                ...incidentPriorities.map(
                                                                    (incidentPriority: $TSFixMe) => ({
                                                                        value:
                                                                            incidentPriority._id,

                                                                        label:
                                                                            incidentPriority.name
                                                                    })
                                                                ),
                                                            ]}
                                                            autoFocus={true}
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

                                                                .editIncident
                                                                .requesting
                                                        }
                                                        validate={[
                                                            ValidateField.required,
                                                        ]}
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
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={editIncident.error}>
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
                                                            {editIncident.error}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            onClick={() =>

                                                this.props.closeThisDialog()
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="saveIncident"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={
                                                editIncident &&
                                                editIncident.requesting
                                            }
                                            type="submit"
                                        >
                                            {editIncident &&
                                                !editIncident.requesting && (
                                                    <>
                                                        <span>Save</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                            {editIncident &&
                                                editIncident.requesting && (
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


EditIncident.displayName = 'EditIncident';

EditIncident.propTypes = {
    incidentPriorities: PropTypes.array.isRequired,
};
const EditIncidentForm = reduxForm({
    form: 'editIncident',
})(EditIncident);

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            updateIncident,
        },
        dispatch
    );
};

function mapStateToProps(state: RootState, ownProps: $TSFixMe) {
    const incident = ownProps.data.incident;
    const initialValues = {
        title: incident.title,
        description: incident.description,
        incidentPriority: incident.incidentPriority
            ? incident.incidentPriority._id
            : null,
        incidentType: incident.incidentType,
    };
    return {
        currentProject: state.project.currentProject,
        editIncident: state.incident.editIncident,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
        initialValues,
    };
}


EditIncident.propTypes = {
    updateIncident: PropTypes.func.isRequired,
    data: PropTypes.object,
    handleSubmit: PropTypes.func.isRequired,
    editIncident: PropTypes.object,
    currentProject: PropTypes.object.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(EditIncidentForm);
