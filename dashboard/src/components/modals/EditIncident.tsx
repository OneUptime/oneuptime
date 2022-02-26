import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { updateIncident } from '../../actions/incident';
import { ValidateField } from '../../config';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderField } from '../basic/RenderField';
import RenderCodeEditor from '../basic/RenderCodeEditor';

class EditIncident extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('saveIncident').click();
            default:
                return false;
        }
    };

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { incidentId } = this.props.data;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const projectId = this.props.currentProject._id;
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateIncident' does not exist on type '... Remove this comment to see the full error message
            .updateIncident(
                projectId,
                incidentId,
                values.incidentType,
                values.title,
                values.description,
                values.incidentPriority === '' ? null : values.incidentPriority
            )
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            .then(() => this.props.closeThisDialog());
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncident' does not exist on type 'Re... Remove this comment to see the full error message
            editIncident,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentPriorities' does not exist on ty... Remove this comment to see the full error message
            incidentPriorities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
        } = this.props;
        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncident' does not exist on type 'Re... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncident' does not exist on type 'Re... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
EditIncident.displayName = 'EditIncident';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
EditIncident.propTypes = {
    incidentPriorities: PropTypes.array.isRequired,
};
const EditIncidentForm = reduxForm({
    form: 'editIncident',
})(EditIncident);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            updateIncident,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe, ownProps: $TSFixMe) {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
EditIncident.propTypes = {
    updateIncident: PropTypes.func.isRequired,
    data: PropTypes.object,
    handleSubmit: PropTypes.func.isRequired,
    editIncident: PropTypes.object,
    currentProject: PropTypes.object.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(EditIncidentForm);
