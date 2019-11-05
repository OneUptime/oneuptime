import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import { editEmailTemplates, resetEmailTemplates, changeShowingTemplate } from '../../actions/emailTemplates';
import TemplatesFormBox from './TemplatesFormBox';
import IsAdmin from '../basic/IsAdmin';
import IsOwner from '../basic/IsOwner';

class EmailTemplatesBox extends React.Component {
    submitForm = (values) => {
        const { currentProject } = this.props;
        let val = this.props.emailTemplates.emailTemplates.templates.map(tmp => {
            if (tmp.emailType === values.email_type) {
                tmp.subject = values.subject;
                tmp.body = values.body;
                return tmp;
            }
            else {
                return tmp;
            }
        })
        this.props.editEmailTemplates(currentProject._id, val);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Email Templates Updated');
        }
    }

    resetTemplate = (templateId) => {
        const { currentProject } = this.props;
        this.props.resetEmailTemplates(currentProject._id, templateId);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Email Templates Reset');
        }
    }

    templateChange = (e) => {
        this.props.changeShowingTemplate(e.target.value);
    }
    render() {
        var templates = this.props.emailTemplates && this.props.emailTemplates.emailTemplates && this.props.emailTemplates.emailTemplates.templates ? this.props.emailTemplates.emailTemplates.templates : [];
        return (
            <div className="Box-root Margin-vertical--12">
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className={this.props.emailTemplates && this.props.emailTemplates.showingTemplate && this.props.emailTemplates.showingTemplate.emailType ? '' : 'bs-ContentSection Card-root Card-shadow--medium'}>
                            <div className="Box-root">
                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                <span>Email Templates</span>
                                            </span>
                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Customize your email templates
                                                        </span>
                                            </span>
                                        </div>
                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                            <div className="Box-root">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {IsAdmin(this.props.currentProject) || IsOwner(this.props.currentProject) ?
                                    <form>
                                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2" style={{ boxShadow: 'none' }}>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Templates</label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={'select'}
                                                        name='type_Templates'
                                                        id='type'
                                                        placeholder="Templates"
                                                        required="required"
                                                        onChange={this.templateChange}
                                                        style={{ height: '28px' }}
                                                    >
                                                        <option value="">Select a template.</option>
                                                        {templates.map((temp, i) => <option value={temp.emailType} key={i}>{temp.emailType}</option>)}
                                                    </Field>
                                                </div>
                                            </div>
                                        </div>

                                    </form> :
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2" style={{ boxShadow: 'none' }}>
                                        <div className="bs-Fieldset-row" style={{ textAlign: 'center' }}>
                                            <label className="bs-Fieldset-label" style={{ flex: 'none' }}>Email Template settings are available to only admins and owners.</label>
                                        </div>
                                    </div>
                                }
                                {this.props.emailTemplates.showingTemplate &&
                                    this.props.emailTemplates.showingTemplate.emailType ?
                                    <TemplatesFormBox
                                        submitForm={this.submitForm}
                                        resetTemplate={this.resetTemplate}
                                    /> : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

EmailTemplatesBox.displayName = 'EmailTemplatesBox';

let EmailTemplatesBoxForm = new reduxForm({
    form: 'EmailTemplates',
    enableReinitialize: true,
    destroyOnUnmount: false
})(EmailTemplatesBox);

EmailTemplatesBox.propTypes = {
    emailTemplates: PropTypes.object.isRequired,
    editEmailTemplates: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    resetEmailTemplates: PropTypes.func.isRequired,
    changeShowingTemplate: PropTypes.func.isRequired,
}

const mapDispatchToProps = dispatch => bindActionCreators(
    { editEmailTemplates, resetEmailTemplates, changeShowingTemplate }
    , dispatch);

const mapStateToProps = (state) => {
    return {
        monitor: state.monitor,
        currentProject: state.project.currentProject,
        emailTemplates: state.emailTemplates,
    };
}

EmailTemplatesBox.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(EmailTemplatesBoxForm);