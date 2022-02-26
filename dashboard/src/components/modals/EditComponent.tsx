import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Spinner } from '../basic/Loader';
import { Validate } from '../../config';
import { bindActionCreators } from 'redux';
import { closeModal } from '../../actions/modal';
import { connect } from 'react-redux';
import { editComponent } from '../../actions/component';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.name)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Component name can not be empty!';
    }
    return errors;
}

class EditComponent extends Component {
    // eslint-disable-next-line
    constructor(props: $TSFixMe) {
        super(props);
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('editComponentButton').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editComponentModalId' does not exist on ... Remove this comment to see the full error message
            id: this.props.editComponentModalId,
        });
    };

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
        if (this.props.initialValues.name === values.name) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            return this.props.closeModal({
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'editComponentModalId' does not exist on ... Remove this comment to see the full error message
                id: this.props.editComponentModalId,
            });
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editComponent' does not exist on type 'R... Remove this comment to see the full error message
        this.props.editComponent(this.props.projectId, values).then(() => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            return this.props.closeModal({
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'editComponentModalId' does not exist on ... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
                <ShouldRender if={this.props.editingComponent.error}>
                    <p className="bs-Modal-message">
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
                disabled={this.props.editingComponent.requesting}
                autoFocus={true}
            />
        </div>
    );

    renderFormFooter = () => (
        <div className="bs-Modal-footer">
            <div className="bs-Modal-footer-actions">
                <button
                    className={`bs-Button bs-DeprecatedButton btn__modal`}
                    type="button"
                    onClick={() => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                        this.props.closeModal({
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editComponentModalId' does not exist on ... Remove this comment to see the full error message
                            id: this.props.editComponentModalId,
                        });
                    }}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
                    disabled={this.props.editingComponent.requesting}
                >
                    <span>Cancel</span>
                    <span className="cancel-btn__keycode">Esc</span>
                </button>
                <button
                    id="editComponentButton"
                    className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal`}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '"save"' is not assignable to type '"reset" |... Remove this comment to see the full error message
                    type="save"
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
                    disabled={this.props.editingComponent.requesting}
                >
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingComponent' does not exist on type... Remove this comment to see the full error message
                    <ShouldRender if={this.props.editingComponent.requesting}>
                        <Spinner />
                    </ShouldRender>
                    <span>Update</span>
                    <span className="create-btn__keycode">
                        <span className="keycode__icon keycode__icon--enter" />
                    </span>
                </button>
            </div>
        </div>
    );

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
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
                                <ClickOutside
                                    onClickOutside={this.handleCloseModal}
                                >
                                    {this.renderFormHeader()}
                                    {this.renderFormBody()}
                                    {this.renderFormFooter()}
                                </ClickOutside>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
EditComponent.displayName = EditComponent;

const UpdateComponentForm = reduxForm({
    form: 'EditComponent',
    validate,
})(EditComponent);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    return {
        editComponentModalId: state.modal.modals[0].id,
        initialValues: state.component.componentList.components.map(
            (components: $TSFixMe) => {
                return components.components.filter(
                    (component: $TSFixMe) => component._id === ownProps.data.componentId
                );
            }
        )[0][0],
        editingComponent: state.component.editComponent,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ closeModal, editComponent }, dispatch);
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
