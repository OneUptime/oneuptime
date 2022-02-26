import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import {
    editEmailTemplates,
    resetEmailTemplates,
    changeShowingTemplate,
} from '../../actions/emailTemplates';
import TemplatesFormBox from './TemplatesFormBox';
import IsAdmin from '../basic/IsAdmin';
import IsOwner from '../basic/IsOwner';
import { RenderSelect } from '../basic/RenderSelect';

class EmailTemplatesBox extends React.Component {
    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
        const val = this.props.emailTemplates.emailTemplates.templates.map(
            (tmp: $TSFixMe) => {
                if (tmp.emailType === values.email_type) {
                    tmp.subject = values.subject;
                    tmp.body = values.body;
                    return tmp;
                } else {
                    return tmp;
                }
            }
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editEmailTemplates' does not exist on ty... Remove this comment to see the full error message
        this.props.editEmailTemplates(currentProject._id, val);
    };

    resetTemplate = (templateId: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetEmailTemplates' does not exist on t... Remove this comment to see the full error message
        this.props.resetEmailTemplates(currentProject._id, templateId);
    };

    templateChange = (e: $TSFixMe, value: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'changeShowingTemplate' does not exist on... Remove this comment to see the full error message
        this.props.changeShowingTemplate(value);
    };
    render() {
        const templates =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
            this.props.emailTemplates &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
            this.props.emailTemplates.emailTemplates &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
            this.props.emailTemplates.emailTemplates.templates
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
                ? this.props.emailTemplates.emailTemplates.templates
                : [];
        return (
            <div id="emailTemplate" className="Box-root Margin-vertical--12">
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div
                            className={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
                                this.props.emailTemplates &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
                                this.props.emailTemplates.showingTemplate &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
                                this.props.emailTemplates.showingTemplate
                                    .emailType
                                    ? ''
                                    : 'bs-ContentSection Card-root Card-shadow--medium'
                            }
                        >
                            <div className="Box-root bs-ContentSection Card-root Card-shadow--medium">
                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                <span>Email Templates</span>
                                            </span>
                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Customize your email
                                                    templates
                                                </span>
                                            </span>
                                        </div>
                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                            <div className="Box-root"></div>
                                        </div>
                                    </div>
                                </div>
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                {IsAdmin(this.props.currentProject) ||
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                IsOwner(this.props.currentProject) ? (
                                    <form>
                                        <div
                                            className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                            style={{ boxShadow: 'none' }}
                                        >
                                            <div className="bs-Fieldset-row email-smt-row">
                                                <label className="bs-Fieldset-label">
                                                    Templates
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-select-nw"
                                                        component={RenderSelect}
                                                        name="type_Templates"
                                                        id="type"
                                                        placeholder="Templates"
                                                        required="required"
                                                        onChange={(e: $TSFixMe, v: $TSFixMe) =>
                                                            this.templateChange(
                                                                e,
                                                                v
                                                            )
                                                        }
                                                        style={{
                                                            height: '28px',
                                                        }}
                                                        options={[
                                                            {
                                                                value: '',
                                                                label:
                                                                    'Select a template',
                                                            },
                                                            ...(templates &&
                                                            templates.length > 0
                                                                ? templates.map(
                                                                      (template: $TSFixMe) => ({
                                                                          value:
                                                                              template.emailType,

                                                                          label:
                                                                              template.emailType
                                                                      })
                                                                  )
                                                                : []),
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </form>
                                ) : (
                                    <div
                                        className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                        style={{ boxShadow: 'none' }}
                                    >
                                        <div
                                            className="bs-Fieldset-row"
                                            style={{ textAlign: 'center' }}
                                        >
                                            <label
                                                className="bs-Fieldset-label"
                                                style={{ flex: 'none' }}
                                            >
                                                Email Template settings are
                                                available to only admins and
                                                owners.
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
                            {this.props.emailTemplates.showingTemplate &&
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailTemplates' does not exist on type '... Remove this comment to see the full error message
                            this.props.emailTemplates.showingTemplate
                                .emailType ? (
                                <div className="bs-ContentSection Card-root Card-shadow--medium Margin-vertical--12">
                                    <TemplatesFormBox
                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ submitForm: (values: any) => void; resetTe... Remove this comment to see the full error message
                                        submitForm={this.submitForm}
                                        resetTemplate={this.resetTemplate}
                                    />
                                </div>
                            ) : (
                                ''
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
EmailTemplatesBox.displayName = 'EmailTemplatesBox';

const EmailTemplatesBoxForm = new reduxForm({
    form: 'EmailTemplates',
    enableReinitialize: true,
    destroyOnUnmount: false,
})(EmailTemplatesBox);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
EmailTemplatesBox.propTypes = {
    emailTemplates: PropTypes.object.isRequired,
    editEmailTemplates: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    resetEmailTemplates: PropTypes.func.isRequired,
    changeShowingTemplate: PropTypes.func.isRequired,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { editEmailTemplates, resetEmailTemplates, changeShowingTemplate },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        monitor: state.monitor,
        currentProject: state.project.currentProject,
        emailTemplates: state.emailTemplates,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EmailTemplatesBoxForm);
