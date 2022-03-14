import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { connect } from 'react-redux';
import { Spinner } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import { ValidateField } from '../config';
import { RenderField } from '../components/basic/RenderField';
import PropTypes from 'prop-types';
import { editComponent, fetchComponent } from '../actions/component';
import { bindActionCreators } from 'redux';
import { history } from '../store';

class ComponentSettings extends Component {
    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
        if (this.props.initialValues.name === values.name) {
            return;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editComponent' does not exist on type 'R... Remove this comment to see the full error message
        this.props.editComponent(this.props.projectId, values).then((data: $TSFixMe) => {
            history.replace(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectSlug' does not exist on type 'Rea... Remove this comment to see the full error message
                `/dashboard/project/${this.props.projectSlug}/component/${data.data.slug}/settings/basic`
            );
        });
    };
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId, componentSlug, fetchComponent } = this.props;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
        }
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            prevProps.projectId !== this.props.projectId ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            prevProps.componentSlug !== this.props.componentSlug
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            const { projectId, fetchComponent, componentSlug } = this.props;
            if (projectId) {
                fetchComponent(projectId, componentSlug);
            }
        }
    }
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;
        const componentName = component ? component.name : '';

        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'basic')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={pathname}
                    name="Basic"
                    pageTitle="Basic"
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
                                                                disabled={false}
                                                                validate={
                                                                    ValidateField.text
                                                                }
                                                                autoFocus={true}
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
                                                    this.props.editingComponent
                                                        .error
                                                }
                                            >
                                                <p className="bs-Modal-message">
                                                    {
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
                                                    this.props.editingComponent
                                                        .requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
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
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ComponentSettings.displayName = 'Component Settings Form';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
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
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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
