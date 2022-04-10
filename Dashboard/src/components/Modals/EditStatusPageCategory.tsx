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
import { updateStatusPageCategory } from '../../actions/statusPageCategory';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.name)) {

        errors.name = 'Status Page Category name can not be empty!';
    }
    return errors;
}

interface EditStatusPageCategoryProps {
    handleSubmit: Function;
    closeModal: Function;
    updateStatusPageCategory: Function;
    data?: object;
    updatingCategory?: boolean;
    updateError?: string;
}

class EditStatusPageCategory extends React.Component<EditStatusPageCategoryProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {

        const { data, updateStatusPageCategory } = this.props;
        const {
            statusPageCategoryId,
            projectId,
            statusPageCategoryName,
        } = data;

        if (statusPageCategoryName === values.statusPageCategoryName) {
            return this.handleCloseModal();
        }

        updateStatusPageCategory({
            projectId,
            statusPageCategoryId,
            statusPageCategoryName: values.statusPageCategoryName,
        }).then(() => {

            if (!this.props.updateError) {
                this.handleCloseModal();
            }
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document
                    .getElementById('editStatusPageCategory')
                    .click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({});
    };

    override render() {

        const { handleSubmit, updatingCategory, updateError } = this.props;

        return (
            <form onSubmit={handleSubmit(this.submitForm)}>
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
                                                    Edit Status Page Category
                                                </span>
                                            </span>
                                        </div>
                                        <div className="bs-Modal-messages">
                                            <ShouldRender if={updateError}>
                                                <p className="bs-Modal-message">
                                                    {updateError}
                                                </p>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                    <div className="bs-Modal-body">
                                        <Field
                                            required={true}
                                            component="input"
                                            name="statusPageCategoryName"
                                            placeholder="Status Page Category Name"
                                            id="statusPageCategoryName"
                                            className="bs-TextInput"
                                            style={{
                                                width: '90%',
                                                margin: '10px 0 10px 5%',
                                            }}
                                            disabled={updatingCategory}
                                            autoFocus={true}
                                        />
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <button
                                                className={`bs-Button bs-DeprecatedButton btn__modal ${updatingCategory &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={this.handleCloseModal}
                                                disabled={updatingCategory}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="editStatusPageCategory"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${updatingCategory &&
                                                    'bs-is-disabled'}`}

                                                type="save"
                                                disabled={updatingCategory}
                                            >
                                                <ShouldRender
                                                    if={updatingCategory}
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


EditStatusPageCategory.displayName = 'EditStatusPageCategory';

const EditStatusPageCategoryForm = reduxForm({
    form: 'EditStatusPageCategoryForm',
    validate,
})(EditStatusPageCategory);

const mapStateToProps = (state: RootState, ownProps: $TSFixMe) => {
    const { statusPageCategoryName } = ownProps.data;
    return {
        initialValues: {
            statusPageCategoryName,
        },
        updatingCategory:
            state.statusPageCategory.updateStatusPageCategory.requesting,
        updateError: state.statusPageCategory.updateStatusPageCategory.error,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        { closeModal, updateStatusPageCategory },
        dispatch
    );
};


EditStatusPageCategory.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    updateStatusPageCategory: PropTypes.func.isRequired,
    data: PropTypes.object,
    updatingCategory: PropTypes.bool,
    updateError: PropTypes.string,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditStatusPageCategoryForm);
