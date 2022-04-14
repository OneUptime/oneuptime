import React, { Component } from 'react';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';

import { Field, reduxForm, formValueSelector } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history, RootState } from '../../store';

import { bindActionCreators, Dispatch } from 'redux';
import {
    createApplicationLog,
    createApplicationLogSuccess,
    createApplicationLogFailure,
    editApplicationLogSwitch,
    editApplicationLog,
} from '../../actions/applicationLog';
import { RenderSelect } from '../basic/RenderSelect';
const selector = formValueSelector('NewApplicationLog');

interface NewApplicationLogProps {
    index?: unknown | unknown;
    createApplicationLog: Function;
    applicationLogState: object;
    applicationLog?: object;
    handleSubmit: Function;
    componentId?: string;
    componentSlug?: string;
    requesting?: boolean;
    currentProject?: object;
    edit?: boolean;
    editApplicationLogSwitch?: Function;
    editApplicationLog?: Function;
    resourceCategoryList?: unknown[];
    toggleForm?: Function;
    showCancelBtn?: boolean;
}

class NewApplicationLog extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }
    validate = (values: $TSFixMe) => {
        const errors: $TSFixMe = {};
        if (!ValidateField.text(values[`name`])) {

            errors.name = 'Application Name is required.';
        }
        return errors;
    };
    cancelEdit = () => {

        this.props.editApplicationLogSwitch(this.props.index);
    };
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Enter':
                if (document.getElementById('editApplicationLogButton'))

                    return document
                        .getElementById('editApplicationLogButton')
                        .click();
                else return false;
            default:
                return false;
        }
    };
    submitForm = (values: $TSFixMe) => {
        const thisObj = this;
        const postObj: $TSFixMe = {};

        postObj.name = values[`name`];
        if (values[`resourceCategory`]) {

            postObj.resourceCategory = values[`resourceCategory`];
        }

        if (!this.props.edit) {
            this.props

                .createApplicationLog(

                    this.props.currentProject._id,

                    this.props.componentId,
                    postObj
                )
                .then(
                    () => {

                        thisObj.props.reset();

                        thisObj.props.closeCreateApplicationLogModal();
                    },
                    (error: $TSFixMe) => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        } else {
            this.props

                .editApplicationLog(

                    this.props.currentProject._id,

                    this.props.componentId,

                    this.props.applicationLog._id,
                    postObj
                )
                .then(
                    (data: $TSFixMe) => {
                        history.replace(

                            `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/application-logs/${data.data.slug}`
                        );

                        thisObj.props.reset();

                        thisObj.props.closeCreateApplicationLogModal();
                    },
                    (error: $TSFixMe) => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        }
    };
    override render() {
        const {

            handleSubmit,

            requesting,

            edit,

            applicationLog,

            resourceCategoryList,
        } = this.props;
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <ShouldRender if={!edit}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>New Log Container</span>
                                    </span>
                                    <p>
                                        <span>
                                            Create a log container so you and
                                            your team can monitor the logs
                                            related to it.
                                        </span>
                                    </p>
                                </ShouldRender>
                                <ShouldRender if={edit}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Edit Log Container</span>
                                    </span>
                                    <p>
                                        <span
                                            id={`application-log-edit-title-${applicationLog?.name}`}
                                        >
                                            {`Edit Log Container ${applicationLog?.name}`}
                                        </span>
                                    </p>
                                </ShouldRender>
                            </div>
                        </div>
                        <form
                            id="form-new-application-log"
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
                                                            name={`name`}
                                                            id="name"
                                                            placeholder="Application Name"
                                                            validate={
                                                                ValidateField.text
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                                <ShouldRender
                                                    if={
                                                        false &&
                                                        resourceCategoryList &&
                                                        resourceCategoryList.length >
                                                        0
                                                    }
                                                >
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Resource Category
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-select-nw"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="resourceCategory"
                                                                id="resourceCategory"
                                                                placeholder="Choose Category"
                                                                disabled={
                                                                    requesting
                                                                }
                                                                options={[
                                                                    {
                                                                        value:
                                                                            '',
                                                                        label:
                                                                            'Select category',
                                                                    },
                                                                    ...(resourceCategoryList &&
                                                                        resourceCategoryList.length >
                                                                        0
                                                                        ? resourceCategoryList.map(
                                                                            (category: $TSFixMe) => ({
                                                                                value:
                                                                                    category._id,

                                                                                label:
                                                                                    category.name
                                                                            })
                                                                        )
                                                                        : []),
                                                                ]}
                                                            />
                                                        </div>
                                                    </div>
                                                </ShouldRender>
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

                                                this.props.applicationLogState
                                                    .newApplicationLog.error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {
                                                        this.props

                                                            .applicationLogState
                                                            .newApplicationLog
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={

                                                this.props.applicationLogState
                                                    .editApplicationLog.error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {
                                                        this.props

                                                            .applicationLogState
                                                            .editApplicationLog
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <ShouldRender if={!edit}>
                                    <div>
                                        <ShouldRender
                                            if={

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
                                            id="addApplicationLogButton"
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                        >
                                            <ShouldRender if={!requesting}>
                                                <span>Add Log Container</span>
                                            </ShouldRender>

                                            <ShouldRender if={requesting}>
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={edit}>
                                    <div>
                                        <button
                                            className="bs-Button"
                                            disabled={requesting}
                                            onClick={this.cancelEdit}
                                            type="button"
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id="editApplicationLogButton"
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                        >
                                            <ShouldRender if={!requesting}>
                                                <span>Edit Application </span>
                                            </ShouldRender>

                                            <ShouldRender if={requesting}>
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </ShouldRender>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}


NewApplicationLog.displayName = 'NewApplicationLog';

const NewApplicationLogForm = new reduxForm({
    form: 'NewApplicationLog',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewApplicationLog);

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        createApplicationLog,
        createApplicationLogSuccess,
        createApplicationLogFailure,
        editApplicationLogSwitch,
        editApplicationLog,
    },
    dispatch
);

const mapStateToProps: Function = (state: RootState, ownProps: $TSFixMe) => {
    const name = selector(state, 'name');
    const componentId = ownProps.componentId;
    const requesting = state.applicationLog.newApplicationLog.requesting;
    const currentProject = state.project.currentProject;
    const initialValues: $TSFixMe = {
        name: ownProps.applicationLog ? ownProps.applicationLog.name : '',
        resourceCategory: ownProps.applicationLog
            ? ownProps.applicationLog.resourceCategory
                ? ownProps.applicationLog.resourceCategory._id
                : ''
            : '',
    };
    return {
        applicationLogState: state.applicationLog,
        name,
        componentId,
        requesting,
        currentProject,
        initialValues,
        resourceCategoryList:
            state.resourceCategories.resourceCategoryListForNewResource
                .resourceCategories,
    };
};


NewApplicationLog.propTypes = {
    index: PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    createApplicationLog: PropTypes.func.isRequired,
    applicationLogState: PropTypes.object.isRequired,
    applicationLog: PropTypes.object,
    handleSubmit: PropTypes.func.isRequired,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    requesting: PropTypes.bool,
    currentProject: PropTypes.object,
    edit: PropTypes.bool,
    editApplicationLogSwitch: PropTypes.func,
    editApplicationLog: PropTypes.func,
    resourceCategoryList: PropTypes.array,
    toggleForm: PropTypes.func,
    showCancelBtn: PropTypes.bool,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewApplicationLogForm);
