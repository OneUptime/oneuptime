import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import { reduxForm, Field } from 'redux-form';
import { RenderTextArea } from '../basic/RenderTextArea';
import {
    smsTemplateTitles,
    smsTemplateDescriptions,
} from '../basic/SmsTitleList';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { setRevealVariable } from '../../actions/smsTemplates';

const style = {
    backgroundColor: '#fff',
    borderRadius: '4px',
    width: '600px',
    boxShadow:
        '0 0 0 1px rgba(50, 50, 93, 0.16), 0 0 0 1px rgba(50, 151, 211, 0), 0 0 0 2px rgba(50, 151, 211, 0), 0 1px 1px rgba(0, 0, 0, 0.08)',
};

const bulletpoints = {
    display: 'listItem',
    listStyleType: 'disc',
    listStylePosition: 'inside',
};

function validate(values) {
    const errors = {};
    if (!Validate.text(values.body)) {
        errors.body = 'Please enter sms body';
    }
    return errors;
}

export class SmsTemplatesFormBox extends Component {
    render() {
        const {
            template,
            handleSubmit,
            editSmsTemplates,
            resetSmsTemplates,
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
                                        ? smsTemplateTitles[[template.smsType]]
                                        : 'Default SMS Template'}
                                </span>
                            </span>
                            <p>
                                <span>
                                    {template
                                        ? smsTemplateDescriptions[
                                              [template.smsType]
                                          ]
                                        : 'Default SMS Template'}
                                </span>
                            </p>
                        </div>
                    </div>
                    <form
                        id="frmSmsTemplate"
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
                                                    Template
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        component={
                                                            RenderTextArea
                                                        }
                                                        className="db-FeedbackForm-textarea"
                                                        name="body"
                                                        style={style}
                                                        rows={3}
                                                        maxlength={160}
                                                    />
                                                </div>
                                            </div>
                                            <Field
                                                component="text"
                                                className=""
                                                name="sms_type"
                                                style={{ display: 'none' }}
                                            />

                                            <ShouldRender
                                                if={
                                                    !(
                                                        this.props
                                                            .revealVariable &&
                                                        this.props
                                                            .revealVariable ===
                                                            template.smsType
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
                                                            this.props.setRevealVariable(
                                                                template.smsType
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
                                                    this.props.revealVariable &&
                                                    this.props
                                                        .revealVariable ===
                                                        template.smsType
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
                                                            (allowed, j) => {
                                                                return (
                                                                    <span
                                                                        key={j}
                                                                        className="template-variables"
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
                                            (editSmsTemplates &&
                                                editSmsTemplates.error) ||
                                            (resetSmsTemplates &&
                                                resetSmsTemplates.error)
                                        }
                                    >
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>
                                                {editSmsTemplates.error ||
                                                    resetSmsTemplates.error}
                                            </span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <button
                                    className="bs-Button bs-Button--blue"
                                    disabled={
                                        (editSmsTemplates &&
                                            editSmsTemplates.requesting) ||
                                        (resetSmsTemplates &&
                                            resetSmsTemplates.requesting)
                                    }
                                    type="submit"
                                >
                                    <ShouldRender
                                        if={
                                            !(
                                                editSmsTemplates &&
                                                editSmsTemplates.requesting
                                            ) ||
                                            (resetSmsTemplates &&
                                                resetSmsTemplates.requesting)
                                        }
                                    >
                                        <span>Save</span>
                                    </ShouldRender>

                                    <ShouldRender
                                        if={
                                            (editSmsTemplates &&
                                                editSmsTemplates.requesting) ||
                                            (resetSmsTemplates &&
                                                resetSmsTemplates.requesting)
                                        }
                                    >
                                        <FormLoader />
                                    </ShouldRender>
                                </button>
                                <button
                                    className="bs-Button"
                                    disabled={
                                        (resetSmsTemplates &&
                                            resetSmsTemplates.requesting) ||
                                        !template._id
                                    }
                                    type="button"
                                    onClick={() => {
                                        this.props.resetTemplate(template._id);
                                    }}
                                >
                                    <ShouldRender
                                        if={
                                            !(
                                                resetSmsTemplates &&
                                                resetSmsTemplates.requesting
                                            )
                                        }
                                    >
                                        <span>Reset</span>
                                    </ShouldRender>

                                    <ShouldRender
                                        if={
                                            resetSmsTemplates &&
                                            resetSmsTemplates.requesting
                                        }
                                    >
                                        <FormLoader />
                                    </ShouldRender>
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

SmsTemplatesFormBox.displayName = 'SmsTemplatesFormBox';

SmsTemplatesFormBox.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    setRevealVariable: PropTypes.func.isRequired,
    template: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
    editSmsTemplates: PropTypes.object.isRequired,
    resetSmsTemplates: PropTypes.object.isRequired,
    revealVariable: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
    submitForm: PropTypes.func.isRequired,
    resetTemplate: PropTypes.func.isRequired,
};

const SmsTemplatesFormBoxForm = reduxForm({
    form: 'smstemplatesform', // a unique identifier for this form
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
})(SmsTemplatesFormBox);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            setRevealVariable,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    const template = state.smsTemplates.showingTemplate;
    const val = {
        body: template.body,
        sms_type: template.smsType,
    };
    return {
        template,
        editSmsTemplates: state.smsTemplates.editSmsTemplates,
        resetSmsTemplates: state.smsTemplates.resetSmsTemplates,
        initialValues: val,
        revealVariable: state.smsTemplates.revealVariable,
    };
}

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(SmsTemplatesFormBoxForm);
