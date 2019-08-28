import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { reduxForm, FieldArray } from 'redux-form';
import { AdminNote } from './AdminNote';
import { Validate } from '../../config';

//Client side validation
function validate(values) {
    const errors = {};
    const adminNotesArrayErrors = [];

    if (values.adminNotes) {
        for (var i = 0; i < values.adminNotes.length; i++) {
            const adminNotesErrors = {}
            if (values.adminNotes[i].note) {

                if (!Validate.text(values.adminNotes[i].note)) {
                    adminNotesErrors.note = 'Note is not in text format.'
                    adminNotesArrayErrors[i] = adminNotesErrors
                }
            }
        }

        if (adminNotesArrayErrors.length) {
            errors.adminNotes = adminNotesArrayErrors
        }
    }

    return errors;
}

export class AdminNotes extends Component {

    constructor(props) {
        super(props);
    }

    submitForm = (values) => {
        if(this.props.projectId){
            this.props.addNote(this.props.projectId, values);
        }
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Admin Notes Updated', values);
        }
    }

    render() {
        const { handleSubmit, adminNote, requesting } = this.props;
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Admin Notes</span>
                                </span>
                                <p><span>Leave a comment for this user.</span></p>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit(this.submitForm)}>
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <FieldArray 
                                                    name="adminNotes" 
                                                    component={ AdminNote } 
                                                />
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div>
                                <button
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={this.props.requesting}
                                    type="submit">
                                    <ShouldRender if={this.props.requesting}>
                                        <FormLoader />
                                    </ShouldRender>
                                    <ShouldRender if={!this.props.requesting}>
                                        <span>Save</span>
                                    </ShouldRender>
                                </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        )
    }
}

AdminNotes.displayName = 'AdminNotes'

const mapDispatchToProps = dispatch => bindActionCreators(
    { }
    , dispatch);

const mapStateToProps = state => (
    { }
)

AdminNotes.propTypes = {
    requesting: PropTypes.bool,
    addNote: PropTypes.func.isRequired,
    projectId: PropTypes.string.isRequired
}

let AdminNotesForm = reduxForm({
    form: 'AdminNotes', // a unique identifier for this form
    validate, // <--- validation function given to redux-for
    enableReinitialize: true
})(AdminNotes);

export default connect(mapStateToProps, mapDispatchToProps)(AdminNotesForm);
