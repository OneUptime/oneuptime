import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { Spinner } from '../basic/Loader';
import { closeModal } from '../../actions/modal';
import { createResourceCategory } from '../../actions/resourceCategories';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.name)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Resource Category name is required!';
    }
    return errors;
}

export class AddResourceCategoryForm extends React.Component {
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

    submitForm = (values: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createResourceCategory' does not exist o... Remove this comment to see the full error message
            .createResourceCategory(this.props.projectId, values)
            .then(() => {
                return this.handleCloseModal();
            });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'CreateResourceCategoryModalId' does not ... Remove this comment to see the full error message
                    id: this.props.CreateResourceCategoryModalId,
                });
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document
                    .getElementById('addResourceCategoryButton')
                    .click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'CreateResourceCategoryModalId' does not ... Remove this comment to see the full error message
            id: this.props.CreateResourceCategoryModalId,
        });
    };

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
                        <ClickOutside onClickOutside={this.handleCloseModal}>
                            <div className="bs-BIM">
                                <div className="bs-Modal bs-Modal--medium">
                                    <div className="bs-Modal-header">
                                        <div className="bs-Modal-header-copy">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Create New Resource Category
                                                </span>
                                            </span>
                                        </div>
                                        <div className="bs-Modal-messages">
                                            <ShouldRender
                                                if={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
                                                    this.props.resourceCategory
                                                        .error
                                                }
                                            >
                                                <p className="bs-Modal-message">
                                                    {
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
                                                            .resourceCategory
                                                            .error
                                                    }
                                                </p>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                    <div className="bs-Modal-body">
                                        <Field
                                            required={true}
                                            component="input"
                                            name="resourceCategoryName"
                                            placeholder="Resource Category Name"
                                            id="resourceCategoryName"
                                            className="bs-TextInput"
                                            style={{
                                                width: '90%',
                                                margin: '10px 0 10px 5%',
                                            }}
                                            disabled={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
                                                this.props.resourceCategory
                                                    .requesting
                                            }
                                            autoFocus={true}
                                        />
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <button
                                                className={`bs-Button bs-DeprecatedButton btn__modal ${this
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
                                                    .props.resourceCategory
                                                    .requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={() => {
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                                                    this.props.closeModal({
                                                        id: this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'CreateResourceCategoryModalId' does not ... Remove this comment to see the full error message
                                                            .CreateResourceCategoryModalId,
                                                    });
                                                }}
                                                disabled={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
                                                    this.props.resourceCategory
                                                        .requesting
                                                }
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="addResourceCategoryButton"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${this
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
                                                    .props.resourceCategory
                                                    .requesting &&
                                                    'bs-is-disabled'}`}
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '"save"' is not assignable to type '"reset" |... Remove this comment to see the full error message
                                                type="save"
                                                disabled={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
                                                    this.props.resourceCategory
                                                        .requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
                                                            .resourceCategory
                                                            .requesting
                                                    }
                                                >
                                                    <Spinner />
                                                </ShouldRender>

                                                <span>Add</span>
                                                <span className="create-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </ClickOutside>
                    </div>
                </div>
            </form>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AddResourceCategoryForm.displayName = 'AddResourceCategoryForm';

const CreateAddResourceCategoryForm = reduxForm({
    form: 'AddResourceCategoryForm',
    validate,
})(AddResourceCategoryForm);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        CreateResourceCategoryModalId: state.modal.modals[0].id,
        resourceCategory: state.resourceCategories.newResourceCategory,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ closeModal, createResourceCategory }, dispatch);
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
AddResourceCategoryForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    projectId: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    createResourceCategory: PropTypes.func.isRequired,
    CreateResourceCategoryModalId: PropTypes.string,
    resourceCategory: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateAddResourceCategoryForm);
