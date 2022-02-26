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
import { openModal, closeModal } from '../../actions/modal';
import { createDuplicateStatusPage } from '../../actions/statusPage';
import DuplicateStatusPageConfirmation from './DuplicateStatusPageConfirmation';
import { RenderSelect } from '../basic/RenderSelect';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.name)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Status Page Name is required!';
    }
    return errors;
}

export class StatusPageForm extends React.Component {
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { data, currentProject } = this.props;
        const subProjectId = values.statuspageId || null;
        const name = values.name;
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createDuplicateStatusPage' does not exis... Remove this comment to see the full error message
            .createDuplicateStatusPage(
                currentProject._id,
                subProjectId,
                data.statusPageSlug,
                { name }
            )
            .then((res: $TSFixMe) => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'duplicateModalId' does not exist on type... Remove this comment to see the full error message
                    id: this.props.duplicateModalId,
                });
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.openModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'duplicateModalId' does not exist on type... Remove this comment to see the full error message
                    id: this.props.duplicateModalId,
                    content: DuplicateStatusPageConfirmation,
                    statusPageSlug: res.data.slug,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    slug: this.props.currentProject.slug,
                });
            });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document
                    .querySelector('#btnDuplicateStatusPage')
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
                    .click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'duplicateModalId' does not exist on type... Remove this comment to see the full error message
            id: this.props.duplicateModalId,
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                    this.props.statusPage
                                                        .duplicateStatusPage
                                                        .error
                                                }
                                            >
                                                <p className="bs-Modal-message">
                                                    {
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                    .props.statusPage
                                                    .duplicateStatusPage
                                                    .requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={() => {
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                                                    this.props.closeModal({
                                                        id: this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'duplicateModalId' does not exist on type... Remove this comment to see the full error message
                                                            .duplicateModalId,
                                                    });
                                                }}
                                                disabled={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                    .props.statusPage
                                                    .duplicateStatusPage
                                                    .requesting &&
                                                    'bs-is-disabled'}`}
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '"save"' is not assignable to type '"reset" |... Remove this comment to see the full error message
                                                type="save"
                                                disabled={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                    this.props.statusPage
                                                        .duplicateStatusPage
                                                        .requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
StatusPageForm.displayName = 'StatusPageForm';

const DuplicateStatusPageForm = reduxForm({
    form: 'StatusPageModalForm',
    validate,
})(StatusPageForm);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        duplicateModalId: state.modal.modals[0].id,
        statusPage: state.statusPage,
        subProjects: state.subProject.subProjects.subProjects,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        { openModal, closeModal, createDuplicateStatusPage },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
