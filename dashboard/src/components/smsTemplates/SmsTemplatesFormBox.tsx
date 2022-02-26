import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
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
import { openModal, closeModal } from '../../actions/modal';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import ResetSmsTemplate from '../modals/ResetSmsTemplate';

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

function validate(values: $TSFixMe) {
    const errors = {};
    if (!Validate.text(values.body)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'body' does not exist on type '{}'.
        errors.body = 'Please enter sms body';
    }
    return errors;
}

export class SmsTemplatesFormBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            openSmsTemplateResetModalId: uuidv4(),
        };
    }
    resetTemplate = (id: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetTemplate' does not exist on type 'R... Remove this comment to see the full error message
        const promise = this.props.resetTemplate(id);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSmsTemplateResetModalId' does not ex... Remove this comment to see the full error message
            id: this.state.openSmsTemplateResetModalId,
        });
        return promise;
    };
    closeModalLocal() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSmsTemplateResetModalId' does not ex... Remove this comment to see the full error message
            id: this.state.openSmsTemplateResetModalId,
        });
    }
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'template' does not exist on type 'Readon... Remove this comment to see the full error message
            template,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editSmsTemplates' does not exist on type... Remove this comment to see the full error message
            editSmsTemplates,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetSmsTemplates' does not exist on typ... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2538) FIXME: Type 'any[]' cannot be used as an index type.
                                        ? smsTemplateTitles[[template.smsType]]
                                        : 'Default SMS Template'}
                                </span>
                            </span>
                            <p>
                                <span>
                                    {template
                                        ? smsTemplateDescriptions[
                                              // @ts-expect-error ts-migrate(2538) FIXME: Type 'any[]' cannot be used as an index type.
                                              [template.smsType]
                                          ]
                                        : 'Default SMS Template'}
                                </span>
                            </p>
                        </div>
                    </div>
                    <form
                        id="frmSmsTemplate"
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
                                                        id="templateField"
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
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariable' does not exist on type '... Remove this comment to see the full error message
                                                            .revealVariable &&
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariable' does not exist on type '... Remove this comment to see the full error message
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
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setRevealVariable' does not exist on typ... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariable' does not exist on type '... Remove this comment to see the full error message
                                                    this.props.revealVariable &&
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariable' does not exist on type '... Remove this comment to see the full error message
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
                                    id="saveTemplate"
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
                                <ShouldRender if={template._id}>
                                    <button
                                        id="templateReset"
                                        className="bs-Button"
                                        type="button"
                                        onClick={() =>
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                            this.props.openModal({
                                                id: this.state
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSmsTemplateResetModalId' does not ex... Remove this comment to see the full error message
                                                    .openSmsTemplateResetModalId,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    this.resetTemplate(
                                                        template._id
                                                    ),
                                                content: DataPathHoC(
                                                    ResetSmsTemplate,
                                                    {
                                                        resetSmsTemplates,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <span>Reset</span>
                                    </button>
                                </ShouldRender>
                                {/* <button
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
                                </button> */}
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SmsTemplatesFormBox.displayName = 'SmsTemplatesFormBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SmsTemplatesFormBox.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    setRevealVariable: PropTypes.func.isRequired,
    template: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
    editSmsTemplates: PropTypes.object.isRequired,
    resetSmsTemplates: PropTypes.object.isRequired,
    revealVariable: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
    submitForm: PropTypes.func.isRequired,
    resetTemplate: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
};

const SmsTemplatesFormBoxForm = reduxForm({
    form: 'smstemplatesform', // a unique identifier for this form
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
})(SmsTemplatesFormBox);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            setRevealVariable,
            openModal,
            closeModal,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
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
