import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { v4 as uuidv4 } from 'uuid';

import { reduxForm, Field, formValueSelector } from 'redux-form';
import {
    createComponent,
    createComponentSuccess,
    createComponentFailure,
    resetCreateComponent,
    editComponent,
    editComponentSwitch,
    addSeat,
} from '../../actions/component';
import { RenderField } from '../basic/RenderField';
// import { makeCriteria } from '../../config';
import { FormLoader } from '../basic/Loader';
import AddSeats from '../modals/AddSeats';
import { openModal, closeModal } from 'common-ui/actions/modal';
import { showUpgradeForm } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import { fetchSchedules, scheduleSuccess } from '../../actions/schedule';
import { User } from '../../config';
import { ValidateField } from '../../config';
import { history } from '../../store';

const selector = formValueSelector('NewComponent');

class NewComponent extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            upgradeModalId: uuidv4(),
        };
    }

    //Client side validation
    validate = (values: $TSFixMe) => {
        const errors = {};


        if (!ValidateField.text(values[`name_${this.props.index}`])) {

            errors.name = 'Name is required.';
        }

        return errors;
    };

    componentDidUpdate() {

        const { component } = this.props;
        if (
            component.newComponent.error ===
            "You can't add any more components. Please upgrade plan."
        ) {

            this.props.showUpgradeForm();
        }
    }

    viewCreatedComponent = (slug: $TSFixMe, componentSlug: $TSFixMe) => {
        history.push(
            `/dashboard/project/${slug}/component/${componentSlug}/monitoring`
        );
    };

    submitForm = (values: $TSFixMe) => {
        const thisObj = this;


        const { upgradeModalId } = this.state;
        const postObj = { data: {}, criteria: {} };

        postObj.projectId = this.props.activeSubProjectId;

        postObj.name = values[`name_${this.props.index}`];

        postObj.callScheduleId = values[`callSchedule_${this.props.index}`];

        if (!postObj.projectId)

            postObj.projectId = this.props.currentProject._id;


        if (this.props.edit) {

            postObj._id = this.props.editComponentProp._id;

            this.props.editComponent(postObj.projectId, postObj).then(() => {

                thisObj.props.destroy();
            });
        } else {

            this.props.createComponent(postObj.projectId, postObj).then(

                ({ data: { slug: componentSlug } }) => {

                    thisObj.props.reset();

                    this.viewCreatedComponent(

                        this.props.currentProject.slug,
                        componentSlug
                    );
                },
                (error: $TSFixMe) => {
                    if (
                        error &&
                        error.message &&
                        error.message ===
                        "You can't add any more components. Please add an extra seat to add more components."
                    ) {

                        thisObj.props.openModal({
                            id: upgradeModalId,
                            onClose: () => '',
                            onConfirm: () =>

                                thisObj.props.addSeat(

                                    thisObj.props.currentProject._id
                                ),
                            content: AddSeats,
                        });
                    }
                }
            );
        }
    };

    scheduleChange = (e: $TSFixMe, value: $TSFixMe) => {
        //load call schedules/duties
        if (value && value !== '') {

            this.props.fetchSchedules(value);
        } else {
            const userId = User.getUserId();

            const projectMember = this.props.currentProject.users.find(
                (user: $TSFixMe) => user.userId === userId
            );
            if (projectMember)

                this.props.fetchSchedules(this.props.currentProject._id);
        }
    };

    cancelEdit = () => {

        this.props.editComponentSwitch(this.props.index);
    };

    render() {
        const requesting =

            (this.props.component.newComponent.requesting &&

                !this.props.edit) ||

            (this.props.component.editComponent.requesting && this.props.edit);


        const { handleSubmit } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>

                                        <ShouldRender if={!this.props.edit}>
                                            <span>New Component</span>
                                        </ShouldRender>


                                        <ShouldRender if={this.props.edit}>
                                            <span>
                                                Edit Component

                                                {this.props.editComponentProp &&

                                                    this.props.editComponentProp
                                                        .name
                                                    ? ' - ' +
                                                    this.props

                                                        .editComponentProp
                                                        .name
                                                    : null}
                                            </span>
                                        </ShouldRender>
                                    </span>
                                </span>
                                <p>

                                    <ShouldRender if={!this.props.edit}>
                                        <span>
                                            Components are like containers that
                                            contain other OneUptime resources.
                                            For example: If you&apos;re trying
                                            to monitor your Home Page of your
                                            business, create a new container
                                            called Home.
                                        </span>
                                    </ShouldRender>

                                    <ShouldRender if={this.props.edit}>
                                        <span>
                                            Edit Name and URL of

                                            {this.props.editComponentProp &&

                                                this.props.editComponentProp.name

                                                ? ` ${this.props.editComponentProp.name}`
                                                : ''}
                                        </span>
                                    </ShouldRender>
                                </p>
                            </div>
                        </div>

                        <form
                            id="form-new-component"
                            onSubmit={handleSubmit(this.submitForm)}
                        >
                            <div
                                className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                style={{ boxShadow: 'none' }}
                            >
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Name
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="text"

                                                            name={`name_${this.props.index}`}
                                                            id="name"
                                                            placeholder="Home Page"
                                                            disabled={
                                                                requesting
                                                            }
                                                            validate={
                                                                ValidateField.text
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <div className="bs-Tail-copy">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                        <ShouldRender
                                            if={

                                                this.props.component
                                                    .newComponent.error ||

                                                this.props.component
                                                    .editComponent.error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>

                                                    {this.props.component
                                                        .newComponent.error ||

                                                        this.props.component
                                                            .editComponent
                                                            .error}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div>
                                    <ShouldRender

                                        if={!requesting && this.props.edit}
                                    >
                                        <button
                                            className="bs-Button"
                                            disabled={requesting}
                                            onClick={this.cancelEdit}
                                            type="button"
                                        >
                                            <span>Cancel</span>
                                        </button>
                                    </ShouldRender>
                                    <ShouldRender
                                        if={
                                            !requesting &&

                                            this.props.toggleForm &&

                                            this.props.showCancelBtn
                                        }
                                    >
                                        <button
                                            className="bs-Button"
                                            disabled={requesting}

                                            onClick={this.props.toggleForm}
                                            type="button"
                                        >
                                            <span>Cancel</span>
                                        </button>
                                    </ShouldRender>
                                    <button
                                        id="addComponentButton"
                                        className="bs-Button bs-Button--blue"
                                        disabled={requesting}
                                        type="submit"
                                    >
                                        <ShouldRender

                                            if={!this.props.edit && !requesting}
                                        >
                                            <span>Add Component</span>
                                        </ShouldRender>

                                        <ShouldRender

                                            if={this.props.edit && !requesting}
                                        >
                                            <span>Edit Component </span>
                                        </ShouldRender>

                                        <ShouldRender if={requesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}


NewComponent.displayName = 'NewComponent';

const NewComponentForm = new reduxForm({
    form: 'NewComponent',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewComponent);

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        createComponent,
        createComponentSuccess,
        createComponentFailure,
        resetCreateComponent,
        editComponentSwitch,
        openModal,
        closeModal,
        editComponent,
        addSeat,
        fetchSchedules,
        scheduleSuccess,
        showUpgradeForm,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const name = selector(state, 'name_1000');
    const activeSubProjectId = state.subProject.activeSubProject;

    if (ownProps.edit) {
        const componentSlug = ownProps.match
            ? ownProps.match.params
                ? ownProps.match.params.componentSlug
                : null
            : null;
        return {
            component: state.component,
            currentProject: state.project.currentProject,
            name,
            subProjects: state.subProject.subProjects.subProjects,
            schedules: state.schedule.schedules.data,
            componentId:
                state.component.currentComponent.component &&
                state.component.currentComponent.component._id,
            componentSlug,
            activeSubProjectId,
        };
    } else {
        return {
            initialValues: state.component.newComponent.initialValue,
            component: state.component,
            currentProject: state.project.currentProject,
            name,
            subProjects: state.subProject.subProjects.subProjects,
            schedules: state.schedule.schedules.data,
            activeSubProjectId,
        };
    }
};


NewComponent.propTypes = {
    index: PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    editComponentSwitch: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    editComponent: PropTypes.func.isRequired,
    createComponent: PropTypes.func.isRequired,
    component: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    fetchSchedules: PropTypes.func.isRequired,
    editComponentProp: PropTypes.object,
    edit: PropTypes.bool,
    name: PropTypes.string,
    showUpgradeForm: PropTypes.func,
    toggleForm: PropTypes.func,
    showCancelBtn: PropTypes.bool,
    activeSubProjectId: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(NewComponentForm);
