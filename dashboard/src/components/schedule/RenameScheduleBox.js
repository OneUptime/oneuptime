import React, { Component } from 'react';
import { connect } from 'react-redux';
import { Validate } from '../../config';
import { withRouter } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderField } from '../basic/RenderField';
import { history } from '../../store';
import { reduxForm, Field, reset } from 'redux-form';
import { renameSchedule } from '../../actions/schedule';
import PropTypes from 'prop-types';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import RenderIfSubProjectMember from '../basic/RenderIfSubProjectMember';



function validate(value) {
    const errors = {};

    if (!Validate.text(value.schedule_name)) {
        errors.name = 'Duty name is required.';
    }

    return errors;
}

export class RenameScheduleBox extends Component {
    

    submitForm = values => {
        const { scheduleId, renameSchedule, subProjectId } = this.props;

        const scheduleName = values.schedule_name;

        if (scheduleName) {
            renameSchedule(subProjectId, scheduleId, scheduleName).then(
                data => {
                    history.replace(
                        `/dashboard/project/${this.props.currentProjectSlug}/schedule/${data.data[0].slug}`
                    );
                }
            );
            
        }
    };

    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>On-Call Duty Description</span>
                                </span>
                                <p>
                                    <RenderIfSubProjectAdmin>
                                        <span>
                                            Use the field below to name the
                                            duty.
                                        </span>
                                    </RenderIfSubProjectAdmin>
                                    <RenderIfSubProjectMember>
                                        <span>
                                            Basic information about this duty.
                                        </span>
                                    </RenderIfSubProjectMember>
                                </p>
                            </div>
                        </div>
                        <form
                            onSubmit={this.props.handleSubmit(this.submitForm)}
                        >
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Duty Name
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <RenderIfSubProjectAdmin>
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                name="schedule_name"
                                                                id="name"
                                                                placeholder="New On-Call Duty Name"
                                                                required="required"
                                                                disabled={
                                                                    this.props
                                                                        .isRequesting
                                                                }
                                                            />
                                                        </RenderIfSubProjectAdmin>
                                                        <RenderIfSubProjectMember>
                                                            <label className="bs-Fieldset-label">
                                                                {this.props
                                                                    .initialValues &&
                                                                this.props
                                                                    .initialValues
                                                                    .schedule_name
                                                                    ? this.props
                                                                          .initialValues
                                                                          .schedule_name
                                                                    : 'Unnamed Schedule'}
                                                            </label>
                                                        </RenderIfSubProjectMember>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <RenderIfSubProjectAdmin>
                                        <button
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                        >
                                            <ShouldRender
                                                if={!this.props.isRequesting}
                                            >
                                                <span>Save</span>
                                            </ShouldRender>
                                            <ShouldRender
                                                if={this.props.isRequesting}
                                            >
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </RenderIfSubProjectAdmin>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

RenameScheduleBox.displayName = 'RenameScheduleBox';

const formName = 'RenameSchedule' + Math.floor(Math.random() * 10 + 1);

const onSubmitSuccess = (result, dispatch) => dispatch(reset(formName));

const RenameScheduleForm = new reduxForm({
    form: formName,
    validate,
    onSubmitSuccess,
    enableReinitialize: true,
})(RenameScheduleBox);

const mapDispatchToProps = dispatch =>
    bindActionCreators({ renameSchedule }, dispatch);

const mapStateToProps = (state, props) => {
    const { scheduleSlug } = props.match.params;

    let schedule = state.schedule.subProjectSchedules.map(
        subProjectSchedule => {
            return subProjectSchedule.schedules.find(
                schedule => schedule.slug === scheduleSlug
            );
        }
    );

    schedule = schedule.find(
        schedule => schedule && schedule.slug === scheduleSlug
    );

    const schedule_name = schedule && schedule.name;
    const currentProjectSlug =
        state.project.currentProject && state.project.currentProject.slug;
    return {
        initialValues: { schedule_name },
        schedule,
        subProjectId: schedule && schedule.projectId._id,
        scheduleId: schedule && schedule._id,
        currentProjectSlug,
        isRequesting: state.schedule.renameSchedule.requesting,
    };
};

RenameScheduleBox.propTypes = {
    scheduleId: PropTypes.string,
    subProjectId: PropTypes.string,
    currentProjectSlug: PropTypes.string,
    handleSubmit: PropTypes.func.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    renameSchedule: PropTypes.func.isRequired,
    initialValues: PropTypes.oneOfType([
        PropTypes.oneOf([null, undefined]),
        PropTypes.object,
    ]),
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(RenameScheduleForm)
);
