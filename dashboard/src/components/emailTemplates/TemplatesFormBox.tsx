import React from 'react';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { bindActionCreators } from 'redux';
import { Component } from 'react';
import { RenderField } from '../basic/RenderField';
import {
    emailTemplateTitles,
    emailTemplateDescriptions,
} from '../basic/EmailTitleList';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { setRevealVariable } from '../../actions/emailTemplates';
import RenderIfAdmin from '../basic/RenderIfAdmin';
import RenderCodeEditor from '../basic/RenderCodeEditor';

const bulletpoints = {
    display: 'listItem',
    listStyleType: 'disc',
    listStylePosition: 'inside',
};

function validate(values: $TSFixMe) {
    const errors = {};
    if (!Validate.text(values.subject)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subject' does not exist on type '{}'.
        errors.subject = 'Please enter email subject';
    }
    if (!Validate.text(values.body)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'body' does not exist on type '{}'.
        errors.body = 'Please enter email body';
    }
    return errors;
}

export class TemplatesFormBox extends Component {
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'template' does not exist on type 'Readon... Remove this comment to see the full error message
            template,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editEmailTemplates' does not exist on ty... Remove this comment to see the full error message
            editEmailTemplates,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetEmailTemplates' does not exist on t... Remove this comment to see the full error message
            resetEmailTemplates,
        } = this.props;
        return (
            <div
                className="bs-ContentSection Card-root Card-shadow--medium"
                style={{ borderRadius: '0px', boxShadow: 'none' }}
            >
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    {template
                                        ? emailTemplateTitles[
                                              // @ts-expect-error ts-migrate(2538) FIXME: Type 'any[]' cannot be used as an index type.
                                              [template.emailType]
                                          ]
                                        : 'Default Email Template'}
                                </span>
                            </span>
                            <p>
                                <span>
                                    {template
                                        ? emailTemplateDescriptions[
                                              // @ts-expect-error ts-migrate(2538) FIXME: Type 'any[]' cannot be used as an index type.
                                              [template.emailType]
                                          ]
                                        : 'Default Email Template'}
                                </span>
                            </p>
                        </div>
                    </div>
                    <form
                        id="frmEmailTemplate"
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'submitForm' does not exist on type 'Read... Remove this comment to see the full error message
                        onSubmit={handleSubmit(this.props.submitForm)}
                    >
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{ flex: '10% 0 0' }}
                                                >
                                                    Subject
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={RenderField}
                                                        type="text"
                                                        name="subject"
                                                        id="name"
                                                        required="required"
                                                        style={{
                                                            width: '600px',
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{ flex: '10% 0 0' }}
                                                >
                                                    Template
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        component={
                                                            RenderCodeEditor
                                                        }
                                                        mode="html"
                                                        className="db-FeedbackForm-textarea"
                                                        name="body"
                                                        id="templateTextArea"
                                                        placeholder="This can be markdown"
                                                        height="504px"
                                                        width="600px"
                                                    />
                                                </div>
                                            </div>
                                            <Field
                                                component="text"
                                                className=""
                                                name="email_type"
                                                style={{ display: 'none' }}
                                            />

                                            <ShouldRender
                                                if={
                                                    !(
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariable' does not exist on type '... Remove this comment to see the full error message
                                                            .revealVariable &&
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariable' does not exist on type '... Remove this comment to see the full error message
                                                            .revealVariable ===
                                                            template.emailType
                                                    )
                                                }
                                            >
                                                <span
                                                    className="template-variable-1"
                                                    style={{
                                                        display: 'block',
                                                        marginLeft: '120px',
                                                    }}
                                                >
                                                    <button
                                                        className="button-as-anchor"
                                                        onClick={() =>
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setRevealVariable' does not exist on typ... Remove this comment to see the full error message
                                                            this.props.setRevealVariable(
                                                                template.emailType
                                                            )
                                                        }
                                                    >
                                                        {' '}
                                                        Click here to reveal
                                                        available variables.
                                                    </button>
                                                </span>
                                            </ShouldRender>
                                            <ShouldRender
                                                if={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariable' does not exist on type '... Remove this comment to see the full error message
                                                    this.props.revealVariable &&
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariable' does not exist on type '... Remove this comment to see the full error message
                                                        .revealVariable ===
                                                        template.emailType
                                                }
                                            >
                                                <span
                                                    className="template-variable-2"
                                                    style={{
                                                        display: 'block',
                                                        marginLeft: '110px',
                                                        padding: '10px',
                                                    }}
                                                >
                                                    You can use these available
                                                    variables.
                                                </span>
                                                <span
                                                    className="template-variable-1"
                                                    style={{
                                                        display: 'block',
                                                        marginLeft: '120px',
                                                    }}
                                                >
                                                    {template &&
                                                        template.allowedVariables &&
                                                        template.allowedVariables.map(
                                                            (allowed: $TSFixMe, j: $TSFixMe) => {
                                                                return (
                                                                    <span
                                                                        key={j}
                                                                        className="template-variables"
                                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ display: string; listStyleType: string; li... Remove this comment to see the full error message
                                                                        style={
                                                                            bulletpoints
                                                                        }
                                                                    >
                                                                        {
                                                                            allowed
                                                                        }
                                                                        <br />
                                                                    </span>
                                                                );
                                                            }
                                                        )}
                                                </span>
                                            </ShouldRender>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <div className="bs-Tail-copy">
                                <div
                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                    style={{ marginTop: '10px' }}
                                >
                                    <ShouldRender
                                        if={
                                            (editEmailTemplates &&
                                                editEmailTemplates.error) ||
                                            (resetEmailTemplates &&
                                                resetEmailTemplates.error)
                                        }
                                    >
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>
                                                {editEmailTemplates.error ||
                                                    resetEmailTemplates.error}
                                            </span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <RenderIfAdmin>
                                    <button
                                        className="bs-Button bs-Button--blue"
                                        disabled={
                                            (editEmailTemplates &&
                                                editEmailTemplates.requesting) ||
                                            (resetEmailTemplates &&
                                                resetEmailTemplates.requesting)
                                        }
                                        type="submit"
                                        id="saveTemplate"
                                    >
                                        <ShouldRender
                                            if={
                                                !(
                                                    editEmailTemplates &&
                                                    editEmailTemplates.requesting
                                                )
                                            }
                                        >
                                            <span>Save</span>
                                        </ShouldRender>

                                        <ShouldRender
                                            if={
                                                editEmailTemplates &&
                                                editEmailTemplates.requesting
                                            }
                                        >
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                    <ShouldRender if={template._id}>
                                        <button
                                            className={
                                                resetEmailTemplates &&
                                                resetEmailTemplates.requesting
                                                    ? 'bs-Button bs-Button--blue'
                                                    : 'bs-Button'
                                            }
                                            disabled={
                                                resetEmailTemplates &&
                                                resetEmailTemplates.requesting
                                            }
                                            type="button"
                                            onClick={() => {
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetTemplate' does not exist on type 'R... Remove this comment to see the full error message
                                                this.props.resetTemplate(
                                                    template._id
                                                );
                                            }}
                                            id="templateReset"
                                        >
                                            <ShouldRender
                                                if={
                                                    !(
                                                        resetEmailTemplates &&
                                                        resetEmailTemplates.requesting
                                                    )
                                                }
                                            >
                                                <span>Reset</span>
                                            </ShouldRender>

                                            <ShouldRender
                                                if={
                                                    resetEmailTemplates &&
                                                    resetEmailTemplates.requesting
                                                }
                                            >
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </ShouldRender>
                                </RenderIfAdmin>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
TemplatesFormBox.displayName = 'TemplatesFormBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TemplatesFormBox.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    setRevealVariable: PropTypes.func.isRequired,
    template: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
    editEmailTemplates: PropTypes.object.isRequired,
    resetEmailTemplates: PropTypes.object.isRequired,
    revealVariable: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
    submitForm: PropTypes.func.isRequired,
    resetTemplate: PropTypes.func.isRequired,
};

const TemplatesFormBoxForm = reduxForm({
    form: 'templatesform', // a unique identifier for this form
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
})(TemplatesFormBox);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            setRevealVariable,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    const template = state.emailTemplates.showingTemplate;
    const val = {
        subject: template.subject,
        body: template.body,
        email_type: template.emailType,
    };
    return {
        template,
        editEmailTemplates: state.emailTemplates.editEmailTemplates,
        resetEmailTemplates: state.emailTemplates.resetEmailTemplates,
        initialValues: val,
        revealVariable: state.emailTemplates.revealVariable,
    };
}

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(TemplatesFormBoxForm);
