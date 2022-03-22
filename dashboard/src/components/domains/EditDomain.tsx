import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { reduxForm, Field, SubmissionError } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'common-ui/actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';

import {
    updateProjectDomain,
    fetchProjectDomains,
    resetUpdateProjectDomain,
} from '../../actions/project';


function validate(_values: $TSFixMe) {
    const error = undefined;
    return error;
}

class EditDomain extends React.Component {
    componentDidMount() {

        this.props.resetUpdateProjectDomain();
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const {

            projectId,

            updateProjectDomain,

            fetchProjectDomains,

            domainId,

            currentProject,
        } = this.props;

        if (!values.domain || !values.domain.trim()) {
            throw new SubmissionError({
                domain: 'Domain is required',
            });
        }

        if (!Validate.isDomain(values.domain)) {
            throw new SubmissionError({
                domain: 'Domain is not valid.',
            });
        }

        const data = {
            projectId,
            domainId,
            data: {
                domain: values.domain,
            },
        };

        updateProjectDomain(data).then(() => {

            if (!this.props.updateDomainError) {
                fetchProjectDomains(currentProject._id, 0, 10);
                this.handleCloseModal();
            }
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document.getElementById('updateDomainBtn').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.domainId,
        });
    };

    render() {

        const { requesting, updateDomainError, handleSubmit } = this.props;

        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 500 }}>
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
                                        <span>Edit Domain</span>
                                    </span>
                                    <br />
                                    <br />
                                    <span></span>
                                </div>
                            </div>
                            <form
                                id="updateDomainModal"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="domain"
                                                    >
                                                        <span>Domain</span>
                                                    </label>
                                                    <div
                                                        style={{
                                                            width: '100%',
                                                        }}
                                                    >
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <Field
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="domain"
                                                                placeholder="example.com"
                                                                id="domain"
                                                                className="bs-TextInput"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '3px 5px',
                                                                }}
                                                                autoFocus={true}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={updateDomainError}>
                                            <div
                                                className="bs-Tail-copy"
                                                style={{ width: 200 }}
                                                id="updateDomainError"
                                            >
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
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
                                                            {updateDomainError}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={this.handleCloseModal}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="updateDomainBtn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Update Domain</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {requesting && <FormLoader />}
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


EditDomain.displayName = 'EditDomain';


EditDomain.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    projectId: PropTypes.string,
    domainId: PropTypes.string,
    updateDomainError: PropTypes.string,
    updateProjectDomain: PropTypes.func,
    fetchProjectDomains: PropTypes.func,
    resetUpdateProjectDomain: PropTypes.func,
    currentProject: PropTypes.object,
};

const EditDomainForm = reduxForm({
    form: 'EditDomainForm',
    enableReinitialize: false,
    destroyOnUnmount: true,
    validate,
})(EditDomain);

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
        updateProjectDomain,
        fetchProjectDomains,
        resetUpdateProjectDomain,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    const initialValues = {
        domain: state.modal.modals[0].domain,
    };
    return {
        projectId: state.modal.modals[0].projectId,
        domainId: state.modal.modals[0].id,
        currentProject: state.modal.modals[0].currentProject,
        initialValues,
        requesting: state.project.updateDomain.requesting,
        updateDomainError: state.project.updateDomain.error,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(EditDomainForm);
