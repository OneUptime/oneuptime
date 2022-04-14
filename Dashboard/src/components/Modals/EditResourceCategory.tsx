import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { reduxForm, Field } from 'redux-form';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { Spinner } from '../basic/Loader';
import { closeModal } from 'CommonUI/actions/modal';
import { updateResourceCategory } from '../../actions/resourceCategories';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.name)) {

        errors.name = 'Resource Category name can not be empty!';
    }
    return errors;
}

interface EditResourceCategoryFormProps {
    handleSubmit: Function;
    closeModal: Function;
    projectId?: object | string;
    updateResourceCategory: Function;
    EditResourceCategoryModalId?: string;
    resourceCategory?: object;
    initialValues?: object;
}

export class EditResourceCategoryForm extends React.Component<EditResourceCategoryFormProps> {
    // eslint-disable-next-line
    constructor(props: $TSFixMe) {
        super(props);
    }

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {

        const { _id } = this.props.initialValues;

        if (this.props.initialValues.name === values.name) {

            return this.props.closeModal({

                id: this.props.EditResourceCategoryModalId,
            });
        }
        this.props

            .updateResourceCategory(this.props.projectId, _id, values)
            .then(() => {

                return this.props.closeModal({

                    id: this.props.EditResourceCategoryModalId,
                });
            });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document
                    .getElementById('addResourceCategoryButton')
                    .click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.EditResourceCategoryModalId,
        });
    };

    override render() {

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
                                    <div className="bs-Modal-header">
                                        <div className="bs-Modal-header-copy">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Edit Resource Category
                                                </span>
                                            </span>
                                        </div>
                                        <div className="bs-Modal-messages">
                                            <ShouldRender
                                                if={

                                                    this.props.resourceCategory
                                                        .error
                                                }
                                            >
                                                <p className="bs-Modal-message">
                                                    {
                                                        this.props

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
                                            name="name"
                                            placeholder="Resource Category Name"
                                            id="resourceCategoryName"
                                            className="bs-TextInput"
                                            style={{
                                                width: '90%',
                                                margin: '10px 0 10px 5%',
                                            }}
                                            disabled={

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

                                                    .props.resourceCategory
                                                    .requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={() => {

                                                    this.props.closeModal({
                                                        id: this.props

                                                            .EditResourceCategoryModalId,
                                                    });
                                                }}
                                                disabled={

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

                                                    .props.resourceCategory
                                                    .requesting &&
                                                    'bs-is-disabled'}`}

                                                type="save"
                                                disabled={

                                                    this.props.resourceCategory
                                                        .requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        this.props

                                                            .resourceCategory
                                                            .requesting
                                                    }
                                                >
                                                    <Spinner />
                                                </ShouldRender>
                                                <span>Update</span>
                                                <span className="create-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                </ClickOutside>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}


EditResourceCategoryForm.displayName = 'EditResourceCategoryForm';

const UpdateResourceCategoryForm = reduxForm({
    form: 'EditResourceCategoryForm',
    validate,
})(EditResourceCategoryForm);

const mapStateToProps: Function = (state: RootState, ownProps: $TSFixMe) => {
    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        EditResourceCategoryModalId: state.modal.modals[0].id,
        resourceCategory: state.resourceCategories.updatedResourceCategory,
        initialValues: state.resourceCategories.resourceCategoryList
            ? state.resourceCategories.resourceCategoryList.resourceCategories.filter(
                (obj: $TSFixMe) => obj._id === ownProps.data.resourceCategoryId
            )[0]
            : {},
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators({ closeModal, updateResourceCategory }, dispatch);
};


EditResourceCategoryForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    projectId: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    updateResourceCategory: PropTypes.func.isRequired,
    EditResourceCategoryModalId: PropTypes.string,
    resourceCategory: PropTypes.object,
    initialValues: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(UpdateResourceCategoryForm);
