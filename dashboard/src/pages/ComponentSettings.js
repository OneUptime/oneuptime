import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { connect } from 'react-redux';
import { Spinner } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
import { reduxForm, Field } from 'redux-form';
import { ValidateField } from '../config';
import { RenderField } from '../components/basic/RenderField';
import PropTypes from 'prop-types';
import { editComponent, fetchComponent } from '../actions/component';
import { bindActionCreators } from 'redux';
import { history } from '../store';

class ComponentSettings extends Component {
    submitForm = values => {
        if (this.props.initialValues.name === values.name) {
            return;
        }
        this.props.editComponent(this.props.projectId, values).then(data => {
            history.replace(
                `/dashboard/project/${this.props.projectSlug}/${data.data.slug}/settings/basic`
            );
        });
    };
    componentDidMount() {
        this.props.fetchComponent(this.props.componentSlug);
    }
    render() {
        const {
            location: { pathname },
            component,
            handleSubmit,
        } = this.props;
        const componentName = component ? component.name : '';

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname, null, 'basic')}
                        name={componentName}
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name="Component Settings"
                        pageTitle="Advanced"
                    />
                    <div className="Box-root Margin-vertical--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                <span>
                                                    Edit Component -{' '}
                                                    <span
                                                        id={`component-title-${componentName}`}
                                                    >
                                                        {componentName}
                                                    </span>
                                                </span>
                                            </span>
                                        </span>
                                        <p>
                                            <span>
                                                Edit Name of {componentName}
                                            </span>
                                        </p>
                                    </div>
                                </div>
                                <form
                                    id="componentSettingsForm"
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
                                                        <div className="bs-container-input">
                                                            <label className="bs-Fieldset-label Fieldset-extra">
                                                                Name
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="text"
                                                                    name="name"
                                                                    id="name"
                                                                    placeholder="Component name"
                                                                    disabled={
                                                                        false
                                                                    }
                                                                    validate={
                                                                        ValidateField.text
                                                                    }
                                                                    autoFocus={
                                                                        true
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            </div>
                                        </div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                            }}
                                            className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12"
                                        >
                                            <div className="bs-Modal-messages">
                                                <ShouldRender
                                                    if={
                                                        this.props
                                                            .editingComponent
                                                            .error
                                                    }
                                                >
                                                    <p className="bs-Modal-message">
                                                        {
                                                            this.props
                                                                .editingComponent
                                                                .error
                                                        }
                                                    </p>
                                                </ShouldRender>
                                            </div>
                                            <div>
                                                <button
                                                    id="editComponentButton"
                                                    className="bs-Button bs-Button--blue"
                                                    type="submit"
                                                    disabled={
                                                        this.props
                                                            .editingComponent
                                                            .requesting
                                                    }
                                                >
                                                    <ShouldRender
                                                        if={
                                                            this.props
                                                                .editingComponent
                                                                .requesting
                                                        }
                                                    >
                                                        <Spinner />
                                                    </ShouldRender>
                                                    <span>Update</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

ComponentSettings.displayName = 'Component Settings Form';

ComponentSettings.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    componentSlug: PropTypes.string,
    handleSubmit: PropTypes.func,
    fetchComponent: PropTypes.func,
    initialValues: PropTypes.shape({ name: PropTypes.string }),
    editComponent: PropTypes.func.isRequired,
    projectId: PropTypes.string,
    projectSlug: PropTypes.string,
    editingComponent: PropTypes.object,
};

const mapStateToProps = (state, props) => {
    const { componentSlug } = props.match.params;
    return {
        component:
            state.component && state.component.currentComponent.component,
        componentSlug,
        initialValues:
            state.component && state.component.currentComponent.component,
        editingComponent: state.component.editComponent,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        projectSlug:
            state.project.currentProject && state.project.currentProject.slug,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ editComponent, fetchComponent }, dispatch);
};

const NewComponentSettings = reduxForm({
    form: 'ComponentSettingsForm',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(ComponentSettings);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewComponentSettings);
