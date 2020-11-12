import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { connect } from 'react-redux';
import { FormLoader } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
import { reduxForm, Field } from 'redux-form';
import { ValidateField } from '../config';
import { RenderField } from '../components/basic/RenderField'
import PropTypes from 'prop-types';

class ComponentSettings extends Component {
    ready = () => {
        
    }

    submitForm = values => {

    }

    render() {
        const {
            location: { pathname },
            component,
            handleSubmit
        } = this.props;
        const componentName = component ? component.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname, null, 'component')}
                        name={componentName}
                    />
                    <BreadCrumbItem
                        route={pathname+'/edit'}
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
                                                <span>Edit Component - {componentName}</span>
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
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end' }} className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                            <div>
                                                <button
                                                    id="addContainerBtn"
                                                    className="bs-Button bs-Button--blue"
                                                    // disabled={
                                                    //     addingContainer ||
                                                    //     requestingDockerCredentials
                                                    // }
                                                    type="submit"
                                                >
                                                    <ShouldRender if={!false}>
                                                        <span>Edit Component</span>
                                                    </ShouldRender>

                                                    <ShouldRender if={false}>
                                                        <FormLoader />
                                                    </ShouldRender>
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
        )
    }
}

ComponentSettings.displayName = 'Component Settings Form';

ComponentSettings.propTypes = {
    componentId: PropTypes.string,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    handleSubmit: PropTypes.func
}

const mapStateToProps = (state, ownProps) => {
    const { componentId } = ownProps.match.params;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });
    return {
        component,
        initialValues: {
            name: component && component.name
        }
    }
}

const NewComponentSettings = reduxForm({
    form: 'ComponentSettingsForm',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(ComponentSettings)

export default connect(mapStateToProps, null)(NewComponentSettings);