import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { reduxForm, Field, reset } from 'redux-form';
import { ValidateField } from '../../config';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { addContainerSecurity } from '../../actions/security';
import { getDockerCredentials } from '../../actions/credential';
import { openModal, closeModal } from '../../actions/modal';
import DockerCredentialModal from '../credential/DockerCredentialModal';

class ContainerSecurityForm extends Component {
    componentDidMount() {
        const { projectId, getDockerCredentials } = this.props;

        getDockerCredentials({ projectId });
    }

    submitForm = (values, dispatch) => {
        const { componentId, projectId, addContainerSecurity } = this.props;
        if (!values) return;

        addContainerSecurity({ projectId, componentId, data: values });

        dispatch(reset('ContainerSecurityForm'));
    };

    handleDockerCredential = () => {
        const { openModal, projectId } = this.props;

        openModal({
            id: projectId,
            content: DockerCredentialModal,
            propArr: [{ projectId }],
        });
    };

    handleKeyBoard = e => {
        const { closeModal, projectId } = this.props;

        switch (e.key) {
            case 'Escape':
                return closeModal({
                    id: projectId,
                });
            default:
                return false;
        }
    };

    render() {
        const {
            handleSubmit,
            addingContainer,
            addContainerError,
            requestingDockerCredentials,
            dockerCredentials,
        } = this.props;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-bottom--12"
            >
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <span>Container Security</span>
                                    </span>
                                </span>
                                <p>
                                    <span>
                                        Check the security of your docker
                                        containers
                                    </span>
                                </p>
                            </div>
                        </div>
                        <form
                            id="containerSecurityForm"
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
                                                <div className="bs-Fieldset-row bs-u-justify--center">
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
                                                            name="name"
                                                            id="name"
                                                            placeholder="Container name"
                                                            disabled={
                                                                addingContainer
                                                            }
                                                            validate={
                                                                ValidateField.text
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row bs-u-justify--center">
                                                    <label className="bs-Fieldset-label">
                                                        Docker Credential
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-select-nw"
                                                            component={
                                                                RenderSelect
                                                            }
                                                            name="dockerCredential"
                                                            id="dockerCredential"
                                                            placeholder="Docker Credential"
                                                            required="required"
                                                            style={{
                                                                height: '28px',
                                                            }}
                                                            options={[
                                                                {
                                                                    value: '',
                                                                    label:
                                                                        'Select a Docker Credential',
                                                                },
                                                                ...(dockerCredentials &&
                                                                dockerCredentials.length >
                                                                    0
                                                                    ? dockerCredentials.map(
                                                                          dockerCredential => ({
                                                                              value:
                                                                                  dockerCredential._id,
                                                                              label:
                                                                                  dockerCredential.dockerRegistryUrl,
                                                                          })
                                                                      )
                                                                    : []),
                                                            ]}
                                                        />
                                                        <p
                                                            className="bs-Fieldset-explanation"
                                                            style={{
                                                                color:
                                                                    '#4c4c4c',
                                                                textDecoration:
                                                                    'underline',
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                        >
                                                            <span
                                                                id="addCredentialBtn"
                                                                onClick={
                                                                    this
                                                                        .handleDockerCredential
                                                                }
                                                            >
                                                                Add a docker
                                                                credential
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row bs-u-justify--center">
                                                    <label className="bs-Fieldset-label">
                                                        Image Path
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="text"
                                                            name="imagePath"
                                                            id="imagePath"
                                                            placeholder="fyipeproject/home"
                                                            disabled={
                                                                addingContainer
                                                            }
                                                            validate={
                                                                ValidateField.text
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row bs-u-justify--center">
                                                    <label className="bs-Fieldset-label">
                                                        Image Tags
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="text"
                                                            name="imageTags"
                                                            id="imageTags"
                                                            placeholder="latest"
                                                            disabled={
                                                                addingContainer
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
                                                !addingContainer &&
                                                addContainerError
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {addContainerError}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div>
                                    <button
                                        id="addContainerBtn"
                                        className="bs-Button bs-Button--blue"
                                        disabled={
                                            addingContainer ||
                                            requestingDockerCredentials
                                        }
                                        type="submit"
                                    >
                                        <ShouldRender if={!addingContainer}>
                                            <span>Add Container</span>
                                        </ShouldRender>

                                        <ShouldRender if={addingContainer}>
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

ContainerSecurityForm.displayName = 'Container Security Form';

ContainerSecurityForm.propTypes = {
    addContainerSecurity: PropTypes.func,
    handleSubmit: PropTypes.func,
    componentId: PropTypes.string,
    projectId: PropTypes.string,
    addingContainer: PropTypes.bool,
    addContainerError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    dockerCredentials: PropTypes.array,
    getDockerCredentials: PropTypes.func,
    requestingDockerCredentials: PropTypes.bool,
    closeModal: PropTypes.func,
    openModal: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            addContainerSecurity,
            getDockerCredentials,
            closeModal,
            openModal,
        },
        dispatch
    );

const mapStateToProps = state => {
    return {
        addingContainer: state.security.addContainer.requesting,
        addContainerError: state.security.addContainer.error,
        dockerCredentials: state.credential.dockerCredentials,
        requestingDockerCredentials: state.credential.getCredential.requesting,
    };
};

const NewContainerSecurityForm = reduxForm({
    form: 'ContainerSecurityForm',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(ContainerSecurityForm);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewContainerSecurityForm);
