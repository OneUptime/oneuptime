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
    createProjectDomain,
    fetchProjectDomains,
    resetCreateProjectDomain,
} from '../../actions/project';


function validate(_values: $TSFixMe) {
    const error = undefined;
    return error;
}

class CreateDomain extends React.Component {
    componentDidMount() {

        this.props.resetCreateProjectDomain();
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const {

            projectId,

            createProjectDomain,

            closeModal,

            fetchProjectDomains,
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
            data: {
                domain: values.domain,
            },
        };

        createProjectDomain(data).then(() => {

            if (!this.props.addDomainError) {
                fetchProjectDomains(projectId, 0, 10);
                closeModal({
                    id: projectId,
                });
            }
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document.getElementById('createDomainBtn').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.projectId,
        });
    };

    render() {
        const {

            requesting,

            addDomainError,

            closeModal,

            handleSubmit,

            projectId,
        } = this.props;

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
                                        <span>Add Domain</span>
                                    </span>
                                    <br />
                                    <br />
                                    <span></span>
                                </div>
                            </div>
                            <form
                                id="createDomainModal"
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
                                        <ShouldRender if={addDomainError}>
                                            <div
                                                className="bs-Tail-copy"
                                                style={{ width: 200 }}
                                                id="addDomainError"
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
                                                            {addDomainError}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() =>
                                                closeModal({
                                                    id: projectId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="createDomainBtn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Add Domain</span>
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


CreateDomain.displayName = 'CreateDomain';


CreateDomain.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    projectId: PropTypes.string,
    addDomainError: PropTypes.string,
    createProjectDomain: PropTypes.func,
    fetchProjectDomains: PropTypes.func,
    resetCreateProjectDomain: PropTypes.func,
};

const CreateDomainForm = reduxForm({
    form: 'CreateDomainForm',
    enableReinitialize: false,
    destroyOnUnmount: true,
    validate,
})(CreateDomain);

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
        createProjectDomain,
        fetchProjectDomains,
        resetCreateProjectDomain,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        projectId: state.modal.modals[0].id,
        requesting: state.project.createDomain.requesting,
        addDomainError: state.project.createDomain.error,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(CreateDomainForm);
