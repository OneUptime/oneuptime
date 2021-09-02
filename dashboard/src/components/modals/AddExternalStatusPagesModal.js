import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from '../../actions/modal';
import { createExternalStatusPage } from '../../actions/statusPage';
import { RenderField } from '../basic/RenderField';
import { Validate, ValidateField } from '../../config';

class AddExternalStatusPagesModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        const { statusPage } = this.props.data;
        this.props
            .createExternalStatusPage(
                statusPage.status.projectId._id,
                statusPage.status._id,
                values
            )
            .then(res => {
                if (res) {
                    this.handleCloseModal();
                }
            });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return document
                    .getElementById('createExternalStatusPage')
                    .click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        this.props.closeModal({
            id: this.props.externalStatusPageModalId,
        });
    };

    render() {
        const { handleSubmit } = this.props;

        return (
            <div className="ModalLayer-contents" style={{ marginTop: '40px' }}>
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <ClickOutside onClickOutside={this.handleCloseModal}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Create External Status Page</span>
                                    </span>
                                </div>
                            </div>
                            <form
                                onSubmit={handleSubmit(
                                    this.submitForm.bind(this)
                                )}
                            >
                                <div className="bs-Modal-content bs-u-paddingless">
                                    <div className="bs-Modal-block bs-u-paddingless">
                                        <div className="bs-Modal-content">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Name
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        name="name"
                                                        id="name"
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        component={RenderField}
                                                        autoFocus={true}
                                                        placeholder="Home"
                                                        validate={
                                                            ValidateField.text
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Status Page Url
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        name="url"
                                                        id="url"
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        component={RenderField}
                                                        placeholder="https://mycompany.com"
                                                        validate={
                                                            ValidateField.url
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={
                                                this.props.statusPage &&
                                                this.props.statusPage
                                                    .externalStatusPages.error
                                            }
                                        >
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                        width: '208px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {
                                                                this.props
                                                                    .statusPage
                                                                    .externalStatusPages
                                                                    .error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            onClick={e => {
                                                e.preventDefault();
                                                this.props.closeModal({
                                                    id: this.props
                                                        .externalStatusPageModalId,
                                                });
                                            }}
                                            type="button"
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="createExternalStatusPage"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={
                                                this.props.statusPage
                                                    .externalStatusPages
                                                    .requesting
                                            }
                                            type="submit"
                                        >
                                            {this.props.statusPage
                                                .externalStatusPages &&
                                                !this.props.statusPage
                                                    .externalStatusPages
                                                    .requesting && (
                                                    <>
                                                        <span>Add</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                            {this.props.statusPage
                                                .externalStatusPages &&
                                                this.props.statusPage
                                                    .externalStatusPages
                                                    .requesting && (
                                                    <FormLoader />
                                                )}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

AddExternalStatusPagesModal.displayName = 'AddExternalStatusPagesModal';

//Client side validation
function validate(values) {
    const errors = {};
    if (!Validate.text(values.name)) {
        errors.name = 'Name is not in text format.';
    }
    if (!Validate.text(values.url)) {
        errors.url = 'Url is invalid.';
    }
    return errors;
}

const AddExternalStatusPagesModalForm = reduxForm({
    form: 'AddExternalStatusPagesModal',
    validate, // <--- validation function given to redux-for
})(AddExternalStatusPagesModal);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            closeModal,
            createExternalStatusPage,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        statusPage: state.statusPage,
        currentProject: state.project.currentProject,
        externalStatusPageModalId: state.modal.modals[0].id,
    };
}

AddExternalStatusPagesModal.propTypes = {
    externalStatusPageModalId: PropTypes.string,
    createExternalStatusPage: PropTypes.func,
    handleSubmit: PropTypes.func.isRequired,
    statusPage: PropTypes.object.isRequired,
    data: PropTypes.object,
    closeModal: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(AddExternalStatusPagesModalForm);
