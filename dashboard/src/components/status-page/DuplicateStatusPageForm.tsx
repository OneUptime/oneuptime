import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { reduxForm, Field } from 'redux-form';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { Spinner } from '../basic/Loader';
import { openModal, closeModal } from 'common-ui/actions/modal';
import { createDuplicateStatusPage } from '../../actions/statusPage';
import DuplicateStatusPageConfirmation from './DuplicateStatusPageConfirmation';
import { RenderSelect } from '../basic/RenderSelect';

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
    openModal: Function;
    createDuplicateStatusPage?: Function;
    duplicateModalId: string;
    statusPage?: object;
    currentProject?: object;
    data: object;
    subProjects?: unknown[];
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

        const { data, currentProject } = this.props;
        const subProjectId = values.statuspageId || null;
        const name = values.name;
        this.props

            .createDuplicateStatusPage(
                currentProject._id,
                subProjectId,
                data.statusPageSlug,
                { name }
            )
            .then((res: Response) => {

                this.props.closeModal({

                    id: this.props.duplicateModalId,
                });

                this.props.openModal({

                    id: this.props.duplicateModalId,
                    content: DuplicateStatusPageConfirmation,
                    statusPageSlug: res.data.slug,

                    slug: this.props.currentProject.slug,
                });
            });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document
                    .querySelector('#btnDuplicateStatusPage')

                    .click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.duplicateModalId,
        });
    };

    override render() {

        const { handleSubmit, subProjects } = this.props;
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
                                                    Create Duplicate Status Page
                                                </span>
                                            </span>
                                        </div>
                                        <div className="bs-Modal-messages">
                                            <ShouldRender
                                                if={

                                                    this.props.statusPage
                                                        .duplicateStatusPage
                                                        .error
                                                }
                                            >
                                                <p className="bs-Modal-message">
                                                    {

                                                        this.props.statusPage
                                                            .duplicateStatusPage
                                                            .error
                                                    }
                                                </p>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                    <div className="bs-Modal-body">
                                        <Field
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
                                                    .duplicateStatusPage
                                                    .requesting
                                            }
                                            autoFocus={true}
                                        />
                                    </div>
                                    <ShouldRender
                                        if={
                                            subProjects &&
                                            subProjects.length > 0
                                        }
                                    >
                                        <div className="bs-Modal-body">
                                            <Field
                                                className="db-select-nw"
                                                component={RenderSelect}
                                                name="statuspageId"
                                                id="statuspageId"
                                                options={[
                                                    {
                                                        value: '',
                                                        label:
                                                            'Select a Sub Project',
                                                    },
                                                    ...(subProjects.length > 0
                                                        ? subProjects.map(
                                                            (subProject: $TSFixMe) => ({
                                                                value:
                                                                    subProject._id,

                                                                label:
                                                                    subProject.name
                                                            })
                                                        )
                                                        : []),
                                                ]}
                                            />
                                        </div>
                                    </ShouldRender>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <button
                                                className={`bs-Button bs-DeprecatedButton btn__modal  ${this

                                                    .props.statusPage
                                                    .duplicateStatusPage
                                                    .requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={() => {

                                                    this.props.closeModal({
                                                        id: this.props

                                                            .duplicateModalId,
                                                    });
                                                }}
                                                disabled={

                                                    this.props.statusPage
                                                        .duplicateStatusPage
                                                        .requesting
                                                }
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="btnDuplicateStatusPage"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${this

                                                    .props.statusPage
                                                    .duplicateStatusPage
                                                    .requesting &&
                                                    'bs-is-disabled'}`}

                                                type="save"
                                                disabled={

                                                    this.props.statusPage
                                                        .duplicateStatusPage
                                                        .requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={

                                                        this.props.statusPage
                                                            .duplicateStatusPage
                                                            .requesting
                                                    }
                                                >
                                                    <Spinner />
                                                </ShouldRender>
                                                <span>Duplicate</span>
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

const DuplicateStatusPageForm = reduxForm({
    form: 'StatusPageModalForm',
    validate,
})(StatusPageForm);

const mapStateToProps = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        duplicateModalId: state.modal.modals[0].id,
        statusPage: state.statusPage,
        subProjects: state.subProject.subProjects.subProjects,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        { openModal, closeModal, createDuplicateStatusPage },
        dispatch
    );
};


StatusPageForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    createDuplicateStatusPage: PropTypes.func,
    duplicateModalId: PropTypes.string.isRequired,
    statusPage: PropTypes.object,
    currentProject: PropTypes.object,
    data: PropTypes.object.isRequired,
    subProjects: PropTypes.array,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DuplicateStatusPageForm);
