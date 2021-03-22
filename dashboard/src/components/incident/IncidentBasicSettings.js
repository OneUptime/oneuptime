import React from 'react';
import { reduxForm, Field } from 'redux-form';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { RenderField } from '../basic/RenderField';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import { ValidateField } from '../../config';
import {
    updateBasicIncidentSettings,
    setRevealIncidentSettingsVariables,
} from '../../actions/incidentBasicsSettings';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderSelect } from '../basic/RenderSelect';

class IncidentBasicSettings extends React.Component {
    submit = async values => {
        const projectId = this.props.currentProject._id;
        const { title, description, incidentPriority } = values;
        await this.props.updateBasicIncidentSettings(
            projectId,
            title,
            description,
            incidentPriority === '' ? null : incidentPriority
        );
    };
    render() {
        const { handleSubmit, reset } = this.props;
        return (
            <div
                id="incidentBasicSettingsBox"
                className="Box-root Margin-vertical--12"
            >
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Default Incident Templates
                                                </span>
                                            </span>
                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    These are the default
                                                    templates which will be used
                                                    when a new incident is
                                                    created for this project.
                                                </span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <form onSubmit={handleSubmit(this.submit)}>
                                <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Default Incident
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
                                                            options={[
                                                                ...this.props.incidentPriorities.map(
                                                                    incidentPriority => ({
                                                                        value:
                                                                            incidentPriority._id,
                                                                        label:
                                                                            incidentPriority.name,
                                                                    })
                                                                ),
                                                            ]}
                                                            disabled={
                                                                this.props
                                                                    .updateIncidentBasicSettings
                                                                    .requesting
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Default Incident Title
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            name="title"
                                                            validate={
                                                                ValidateField.text
                                                            }
                                                            disabled={
                                                                this.props
                                                                    .updateIncidentBasicSettings
                                                                    .requesting
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Default Incident Description
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <div
                                                        style={{
                                                            width: '100%',
                                                        }}
                                                    >
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderCodeEditor
                                                            }
                                                            id="description"
                                                            name="description"
                                                            mode="markdown"
                                                            width="250px"
                                                            height="150px"
                                                            wrapEnabled={true}
                                                            disabled={
                                                                this.props
                                                                    .updateIncidentBasicSettings
                                                                    .requesting
                                                            }
                                                        />
                                                    </div>
                                                    <div
                                                        style={{
                                                            marginTop: '20px',
                                                        }}
                                                    >
                                                        <ShouldRender
                                                            if={
                                                                !this.props
                                                                    .revealVariables
                                                            }
                                                        >
                                                            <div
                                                                className="template-variable-1"
                                                                style={{
                                                                    display:
                                                                        'block',
                                                                }}
                                                            >
                                                                <button
                                                                    onClick={() =>
                                                                        this.props.setRevealIncidentSettingsVariables(
                                                                            true
                                                                        )
                                                                    }
                                                                    className="button-as-anchor"
                                                                    type="button"
                                                                >
                                                                    Click here
                                                                    to reveal
                                                                    available
                                                                    variables.
                                                                </button>
                                                            </div>
                                                        </ShouldRender>
                                                        <ShouldRender
                                                            if={
                                                                this.props
                                                                    .revealVariables
                                                            }
                                                        >
                                                            <ul
                                                                className="template-variable-1"
                                                                style={{
                                                                    display:
                                                                        'block',
                                                                }}
                                                            >
                                                                {this.props.settingsVariables.map(
                                                                    (
                                                                        variable,
                                                                        index
                                                                    ) => (
                                                                        <li
                                                                            key={
                                                                                index
                                                                            }
                                                                            className="template-variables"
                                                                            style={{
                                                                                listStyleType:
                                                                                    'disc',
                                                                                listStylePosition:
                                                                                    'inside',
                                                                            }}
                                                                        >
                                                                            {`{{${variable.name}}} : ${variable.definition}`}
                                                                        </li>
                                                                    )
                                                                )}
                                                            </ul>
                                                        </ShouldRender>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                    <span className="db-SettingsForm-footerMessage">
                                        <ShouldRender
                                            if={
                                                this.props
                                                    .updateIncidentBasicSettings
                                                    .error
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
                                                            id="errorInfo"
                                                        >
                                                            {
                                                                this.props
                                                                    .updateIncidentBasicSettings
                                                                    .error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </span>
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                        <div className="Box-root Margin-right--8">
                                            <button
                                                id="resetButton"
                                                className={`Button bs-ButtonLegacy`}
                                                type="button"
                                                disabled={
                                                    this.props
                                                        .updateIncidentBasicSettings
                                                        .requesting
                                                }
                                                onClick={reset}
                                            >
                                                <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                    <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                        <span>Reset</span>
                                                    </span>
                                                </div>
                                            </button>
                                        </div>
                                        <div className="Box-root">
                                            <button
                                                id="saveButton"
                                                className={`Button bs-ButtonLegacy`}
                                                type="submit"
                                                disabled={
                                                    this.props
                                                        .updateIncidentBasicSettings
                                                        .requesting
                                                }
                                            >
                                                <div className="Box-root bs-Button bs-DeprecatedButton bs-Button--blue Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                    <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                        {this.props
                                                            .updateIncidentBasicSettings
                                                            .requesting ? (
                                                            <FormLoader />
                                                        ) : (
                                                            <span>Save</span>
                                                        )}
                                                    </span>
                                                </div>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

IncidentBasicSettings.displayName = 'IncidentBasicSettings';
IncidentBasicSettings.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    reset: PropTypes.func.isRequired,
    updateIncidentBasicSettings: PropTypes.object.isRequired,
    updateBasicIncidentSettings: PropTypes.func.isRequired,
    setRevealIncidentSettingsVariables: PropTypes.func.isRequired,
    revealVariables: PropTypes.bool.isRequired,
    settingsVariables: PropTypes.array.isRequired,
    incidentPriorities: PropTypes.array.isRequired,
};

const IncidentBasicSettingsForm = reduxForm({
    form: 'incidentBasicSettings', // a unique identifier for this form
    enableReinitialize: true,
})(IncidentBasicSettings);

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
        initialValues: state.incidentBasicSettings.incidentBasicSettings,
        updateIncidentBasicSettings:
            state.incidentBasicSettings.updateIncidentBasicSettings,
        revealVariables: state.incidentBasicSettings.revealVariables,
        settingsVariables:
            state.incidentBasicSettings.incidentBasicSettingsVariables
                .incidentBasicSettingsVariables,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
    };
};
const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            updateBasicIncidentSettings,
            setRevealIncidentSettingsVariables,
        },
        dispatch
    );

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentBasicSettingsForm);