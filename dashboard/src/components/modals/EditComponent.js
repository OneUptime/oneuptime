import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import { Spinner } from '../basic/Loader';
import { Validate } from '../../config';
import { bindActionCreators } from 'redux';
import { closeModal } from '../../actions/modal';
import { connect } from 'react-redux';
import { editComponent } from '../../actions/component';
import { PropTypes } from 'prop-types';

function validate(values) {
    const errors = {};

    if (!Validate.text(values.name)) {
        errors.name = 'Component name can not be empty!';
    }
    return errors;
}

class EditComponent extends Component {
    // eslint-disable-next-line
    constructor(props) {
        super(props);
    }

    submitForm = values => {
        if (this.props.initialValues.name === values.name) {
            return this.props.closeModal({
                id: this.props.editComponentModalId,
            });
        }
        this.props.editComponent(this.props.projectId, values).then(() => {
            return this.props.closeModal({
                id: this.props.editComponentModalId,
            });
        });
    };

    renderFormHeader = () => (
        <div className="bs-Modal-header">
            <div className="bs-Modal-header-copy">
                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                    <span>Edit Component</span>
                </span>
            </div>
            <div className="bs-Modal-messages">
                <ShouldRender if={this.props.editingComponent.error}>
                    <p className="bs-Modal-message">
                        {this.props.editingComponent.error}
                    </p>
                </ShouldRender>
            </div>
        </div>
    );

    renderFormBody = () => (
        <div className="bs-Modal-body">
            <Field
                required={true}
                component="input"
                name="name"
                placeholder="Component Name"
                id="componentName"
                className="bs-TextInput"
                style={{
                    width: '90%',
                    margin: '10px 0 10px 5%',
                }}
                disabled={this.props.editingComponent.requesting}
            />
        </div>
    );

    renderFormFooter = () => (
        <div className="bs-Modal-footer">
            <div className="bs-Modal-footer-actions">
                <button
                    className={`bs-Button bs-DeprecatedButton`}
                    type="button"
                    onClick={() => {
                        this.props.closeModal({
                            id: this.props.editComponentModalId,
                        });
                    }}
                    disabled={this.props.editingComponent.requesting}
                >
                    <span>Cancel</span>
                </button>
                <button
                    id="editComponentButton"
                    className={`bs-Button bs-DeprecatedButton bs-Button--blue`}
                    type="save"
                    disabled={this.props.editingComponent.requesting}
                >
                    <ShouldRender if={this.props.editingComponent.requesting}>
                        <Spinner />
                    </ShouldRender>
                    <span>Update</span>
                </button>
            </div>
        </div>
    );

    render() {
        const { handleSubmit } = this.props;

        return (
            <form onSubmit={handleSubmit(this.submitForm.bind(this))}>
                <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                    <div
                        className="ModalLayer-contents"
                        tabIndex={-1}
                        style={{ marginTop: 40 }}
                    >
                        <div className="bs-BIM">
                            <div className="bs-Modal bs-Modal--medium">
                                {this.renderFormHeader()}
                                {this.renderFormBody()}
                                {this.renderFormFooter()}
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

EditComponent.displayName = EditComponent;

const UpdateComponentForm = reduxForm({
    form: 'EditComponent',
    validate,
})(EditComponent);

const mapStateToProps = (state, ownProps) => {
    return {
        editComponentModalId: state.modal.modals[0].id,
        initialValues: state.component.componentList.components.map(
            components => {
                return components.components.filter(
                    component => component._id === ownProps.data.componentId
                );
            }
        )[0][0],
        editingComponent: state.component.editComponent,
        projectId:
            state.project.currentProject !== null &&
            state.project.currentProject._id,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ closeModal, editComponent }, dispatch);
};

EditComponent.propTypes = {
    initialValues: PropTypes.shape({ name: PropTypes.string }),
    closeModal: PropTypes.func.isRequired,
    editComponentModalId: PropTypes.string,
    editComponent: PropTypes.func.isRequired,
    projectId: PropTypes.string,
    editingComponent: PropTypes.shape({
        error: PropTypes.string,
        requesting: PropTypes.bool,
    }),
    handleSubmit: PropTypes.func,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(UpdateComponentForm);
