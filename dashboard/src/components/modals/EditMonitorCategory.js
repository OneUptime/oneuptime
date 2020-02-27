import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { Spinner } from '../basic/Loader';
import { closeModal } from '../../actions/modal';
import { updateMonitorCategory } from '../../actions/monitorCategories';

function validate(values) {
    const errors = {};

    if (!Validate.text(values.name)) {
        errors.name = 'Monitor Category name can not be empty!';
    }
    return errors;
}

export class EditMonitorCategoryForm extends React.Component {
    // eslint-disable-next-line
    constructor(props) {
        super(props);
    }

    submitForm = values => {
        const { _id } = this.props.initialValues;
        if (this.props.initialValues.name === values.name) {
            return this.props.closeModal({
                id: this.props.EditMonitorCategoryModalId,
            });
        }
        this.props
            .updateMonitorCategory(this.props.projectId, _id, values)
            .then(() => {
                return this.props.closeModal({
                    id: this.props.EditMonitorCategoryModalId,
                });
            });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.props.EditMonitorCategoryModalId,
                });
            default:
                return false;
        }
    };

    render() {
        const { handleSubmit } = this.props;

        return (
            <form onSubmit={handleSubmit(this.submitForm.bind(this))}>
                <div
                    onKeyDown={this.handleKeyBoard}
                    className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
                >
                    <div
                        className="ModalLayer-contents"
                        tabIndex={-1}
                        style={{ marginTop: 40 }}
                    >
                        <div className="bs-BIM">
                            <div className="bs-Modal bs-Modal--medium">
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Edit Monitor Category</span>
                                        </span>
                                    </div>
                                    <div className="bs-Modal-messages">
                                        <ShouldRender
                                            if={
                                                this.props.monitorCategory.error
                                            }
                                        >
                                            <p className="bs-Modal-message">
                                                {
                                                    this.props.monitorCategory
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
                                        placeholder="Monitor Category Name"
                                        id="monitorCategoryName"
                                        className="bs-TextInput"
                                        style={{
                                            width: '90%',
                                            margin: '10px 0 10px 5%',
                                        }}
                                        disabled={
                                            this.props.monitorCategory
                                                .requesting
                                        }
                                    />
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className={`bs-Button bs-DeprecatedButton ${this
                                                .props.monitorCategory
                                                .requesting &&
                                                'bs-is-disabled'}`}
                                            type="button"
                                            onClick={() => {
                                                this.props.closeModal({
                                                    id: this.props
                                                        .EditMonitorCategoryModalId,
                                                });
                                            }}
                                            disabled={
                                                this.props.monitorCategory
                                                    .requesting
                                            }
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id="addMonitorCategoryButton"
                                            className={`bs-Button bs-DeprecatedButton bs-Button--blue ${this
                                                .props.monitorCategory
                                                .requesting &&
                                                'bs-is-disabled'}`}
                                            type="save"
                                            disabled={
                                                this.props.monitorCategory
                                                    .requesting
                                            }
                                        >
                                            <ShouldRender
                                                if={
                                                    this.props.monitorCategory
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
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

EditMonitorCategoryForm.displayName = 'EditMonitorCategoryForm';

const UpdateMonitorCategoryForm = reduxForm({
    form: 'EditMonitorCategoryForm',
    validate,
})(EditMonitorCategoryForm);

const mapStateToProps = (state, ownProps) => {
    return {
        projectId:
            state.project.currentProject !== null &&
            state.project.currentProject._id,
        EditMonitorCategoryModalId: state.modal.modals[0].id,
        monitorCategory: state.monitorCategories.updatedMonitorCategory,
        initialValues: state.monitorCategories.monitorCategoryList
            ? state.monitorCategories.monitorCategoryList.monitorCategories.filter(
                  obj => obj._id === ownProps.data.monitorCategoryId
              )[0]
            : {},
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ closeModal, updateMonitorCategory }, dispatch);
};

EditMonitorCategoryForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    projectId: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    updateMonitorCategory: PropTypes.func.isRequired,
    EditMonitorCategoryModalId: PropTypes.string,
    monitorCategory: PropTypes.object,
    initialValues: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(UpdateMonitorCategoryForm);
