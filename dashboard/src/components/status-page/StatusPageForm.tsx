import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { reduxForm, Field } from 'redux-form';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { Spinner } from '../basic/Loader';
import { closeModal } from 'common-ui/actions/modal';

import { createStatusPage } from '../../actions/statusPage';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.name)) {

        errors.name = 'Status Page Name is required!';
    }
    return errors;
}

interface StatusPageFormProps {
    handleSubmit: Function;
    closeModal: Function;
    createStatusPage: Function;
    statusPageModalId: string;
    statusPage?: object;
    data: object;
}

export class StatusPageForm extends React.Component<StatusPageFormProps> {
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

        const { data } = this.props;

        this.props.createStatusPage(data.projectId, values).then(() => {

            return this.props.closeModal({

                id: this.props.statusPageModalId,
            });
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.statusPageModalId,
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
                                                    Create New Status Page
                                                </span>
                                            </span>
                                        </div>
                                        <div className="bs-Modal-messages">
                                            <ShouldRender
                                                if={

                                                    this.props.statusPage
                                                        .newStatusPage.error
                                                }
                                            >
                                                <p className="bs-Modal-message">
                                                    {

                                                        this.props.statusPage
                                                            .newStatusPage.error
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
                                            placeholder="Status Page Name?"
                                            id="name"
                                            className="bs-TextInput"
                                            style={{
                                                width: '90%',
                                                margin: '10px 0 10px 5%',
                                            }}
                                            disabled={

                                                this.props.statusPage
                                                    .newStatusPage.requesting
                                            }
                                            autoFocus={true}
                                        />
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <button
                                                className={`bs-Button bs-DeprecatedButton btn__modal ${this

                                                    .props.statusPage
                                                    .newStatusPage.requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={() => {

                                                    this.props.closeModal({
                                                        id: this.props

                                                            .statusPageModalId,
                                                    });
                                                }}
                                                disabled={

                                                    this.props.statusPage
                                                        .newStatusPage
                                                        .requesting
                                                }
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="btnCreateStatusPage"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${this

                                                    .props.statusPage
                                                    .newStatusPage.requesting &&
                                                    'bs-is-disabled'}`}

                                                type="save"
                                                disabled={

                                                    this.props.statusPage
                                                        .newStatusPage
                                                        .requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={

                                                        this.props.statusPage
                                                            .newStatusPage
                                                            .requesting
                                                    }
                                                >
                                                    <Spinner />
                                                </ShouldRender>

                                                <span>Save</span>
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


StatusPageForm.displayName = 'StatusPageForm';

const CreateStatusPageForm = reduxForm({
    form: 'StatusPageModalForm',
    validate,
})(StatusPageForm);

const mapStateToProps = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        statusPageModalId: state.modal.modals[0].id,
        statusPage: state.statusPage,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({ closeModal, createStatusPage }, dispatch);
};


StatusPageForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    createStatusPage: PropTypes.func.isRequired,
    statusPageModalId: PropTypes.string.isRequired,
    statusPage: PropTypes.object,
    data: PropTypes.object.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateStatusPageForm);
