import React from 'react';
import { connect } from 'react-redux';
import { Field, reduxForm } from 'redux-form';
import { bindActionCreators } from 'redux';
import { Component } from 'react';
import { RenderField } from '../basic/RenderField';
import { RenderTextArea } from '../basic/RenderTextArea';
import { emailTemplateTitles, emailTemplateDescriptions } from '../basic/EmailTitleList';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { setRevealVariable } from '../../actions/emailTemplates';
import RenderIfAdmin from '../basic/RenderIfAdmin';

const style = {
    backgroundColor: '#fff',
    borderRadius: '4px',
    width: '800px',
    boxShadow: '0 0 0 1px rgba(50, 50, 93, 0.16), 0 0 0 1px rgba(50, 151, 211, 0), 0 0 0 2px rgba(50, 151, 211, 0), 0 1px 1px rgba(0, 0, 0, 0.08)',
}

const bulletpoints = {
    display: 'listItem',
      listStyleType: 'disc',
      listStylePosition: 'inside'
}

function validate(values) {
    const errors = {};
    if (!Validate.text(values.subject)) {
        errors.subject = 'Please enter email subject';
    }
    if (!Validate.text(values.body)) {
        errors.body = 'Please enter email body';
    }
    return errors;
}

export class TemplatesFormBox extends Component {

    render() {
        const { template, handleSubmit, editEmailTemplates, resetEmailTemplates } = this.props;
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium" style={{borderRadius:'0px',boxShadow:'none'}}>
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>{template ? emailTemplateTitles[[template.emailType]] : 'Default Email Template'}</span>
                            </span>
                            <p>
                                <span>
                                    {template ? emailTemplateDescriptions[[template.emailType]] : 'Default Email Template'}
                                </span>
                            </p>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.props.submitForm)}>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '10% 0 0' }}>Subject</label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={RenderField}
                                                        type='text'
                                                        name='subject'
                                                        id='name'
                                                        required='required'
                                                        style={{ width: '800px' }}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '10% 0 0' }}>Template</label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field component={RenderTextArea}
                                                        className="db-FeedbackForm-textarea"
                                                        name='body'
                                                        style={style}
                                                        rows={30}
                                                    />
                                                </div>
                                            </div>
                                            <Field component='text'
                                                className=''
                                                name='email_type'
                                                style={{ display: 'none' }}
                                            />

                                            <ShouldRender if={!(this.props.revealVariable && this.props.revealVariable === template.emailType)}>
                                                <span style={{ display: 'block', marginLeft: '120px' }}>
                                                    <a onClick={() => this.props.setRevealVariable(template.emailType)} style={{cursor:'pointer'}}> Click here to reveal available variables.</a>
                                                </span>
                                            </ShouldRender>
                                            <ShouldRender if={(this.props.revealVariable && this.props.revealVariable === template.emailType)}>
                                                <span style={{ display: 'block', marginLeft: '110px', padding: '10px' }}>You can use these available variables.</span>
                                                <span style={{ display: 'block', marginLeft: '120px' }}>
                                                    {template && template.allowedVariables && template.allowedVariables.map((allowed, j) => {
                                                        return <span key={j} className='template-variables' style={bulletpoints}>{allowed}<br /></span>
                                                    })}</span>
                                            </ShouldRender>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">

                            <div className="bs-Tail-copy">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                    <ShouldRender if={(editEmailTemplates && editEmailTemplates.error) || (resetEmailTemplates && resetEmailTemplates.error)}>

                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                            </div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>{editEmailTemplates.error || resetEmailTemplates.error}</span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <RenderIfAdmin>
                                    <button
                                        className="bs-Button bs-Button--blue"
                                        disabled={(editEmailTemplates && editEmailTemplates.requesting) || (resetEmailTemplates && resetEmailTemplates.requesting)}
                                        type="submit"
                                    >
                                        <ShouldRender if={!(editEmailTemplates && editEmailTemplates.requesting)}>
                                            <span>Save</span>
                                        </ShouldRender>

                                        <ShouldRender if={(editEmailTemplates && editEmailTemplates.requesting)}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                    <button
                                        className={resetEmailTemplates && resetEmailTemplates.requesting ? 'bs-Button bs-Button--blue' :'bs-Button'}
                                        disabled={(resetEmailTemplates && resetEmailTemplates.requesting) || !template._id}
                                        type="button"
                                        onClick={() => { this.props.resetTemplate(template._id) }}
                                    >
                                        <ShouldRender if={!(resetEmailTemplates && resetEmailTemplates.requesting)}>
                                            <span>Reset</span>
                                        </ShouldRender>

                                        <ShouldRender if={(resetEmailTemplates && resetEmailTemplates.requesting)}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </RenderIfAdmin>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

TemplatesFormBox.displayName = 'TemplatesFormBox'

TemplatesFormBox.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    setRevealVariable: PropTypes.func.isRequired,
    template: PropTypes.array.isRequired,
    editEmailTemplates: PropTypes.object.isRequired,
    resetEmailTemplates: PropTypes.object.isRequired,
    revealVariable: PropTypes.object.isRequired,
    submitForm :PropTypes.func.isRequired,
    resetTemplate : PropTypes.func.isRequired,
}

let TemplatesFormBoxForm = reduxForm({
    form: 'templatesform', // a unique identifier for this form
    enableReinitialize: true,
    validate // <--- validation function given to redux-for
})(TemplatesFormBox);

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        setRevealVariable,
    }, dispatch)
}

function mapStateToProps(state) {
    const template = state.emailTemplates.showingTemplate;
    var val = {
        subject: template.subject,
        body: template.body,
        email_type: template.emailType,
    }
    return {
        template,
        editEmailTemplates: state.emailTemplates.editEmailTemplates,
        resetEmailTemplates: state.emailTemplates.resetEmailTemplates,
        initialValues: val,
        revealVariable: state.emailTemplates.revealVariable
    };
}

TemplatesFormBox.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(TemplatesFormBoxForm);