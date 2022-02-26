import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { ValidateField } from '../../config';
import { Spinner } from '../basic/Loader';
import { closeModal } from '../../actions/modal';
import { addSiteUrl } from '../../actions/monitor';
import { RenderField } from '../basic/RenderField';

export class AddSiteUrl extends React.Component {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addSiteUrl' does not exist on type 'Read... Remove this comment to see the full error message
            .addSiteUrl(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.props.data.monitorId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.projectId,
                values.url
            )
            .then(() => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'AddSiteUrlModalId' does not exist on typ... Remove this comment to see the full error message
                    id: this.props.AddSiteUrlModalId,
                });
            });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('addSiteUrlButton').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'AddSiteUrlModalId' does not exist on typ... Remove this comment to see the full error message
            id: this.props.AddSiteUrlModalId,
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
                                                <span>Add New Site URL</span>
                                            </span>
                                        </div>
                                        <div className="bs-Modal-messages">
                                            <ShouldRender
                                                if={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMonitor' does not exist on type 'Rea... Remove this comment to see the full error message
                                                    this.props.editMonitor.error
                                                }
                                            >
                                                <p className="bs-Modal-message">
                                                    {
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMonitor' does not exist on type 'Rea... Remove this comment to see the full error message
                                                        this.props.editMonitor
                                                            .error
                                                    }
                                                </p>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                    <div className="bs-Modal-body">
                                        <Field
                                            component={RenderField}
                                            type="url"
                                            name="url"
                                            placeholder="https://example.com"
                                            id="siteUrl"
                                            className="bs-TextInput"
                                            style={{
                                                width: '90%',
                                                margin: '10px 0 10px 5%',
                                            }}
                                            disabled={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMonitor' does not exist on type 'Rea... Remove this comment to see the full error message
                                                this.props.editMonitor
                                                    .requesting
                                            }
                                            validate={[
                                                ValidateField.required,
                                                ValidateField.url,
                                            ]}
                                            autoFocus={true}
                                        />
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <button
                                                className={`bs-Button bs-DeprecatedButton btn__modal ${this
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMonitor' does not exist on type 'Rea... Remove this comment to see the full error message
                                                    .props.editMonitor
                                                    .requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={() => {
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                                                    this.props.closeModal({
                                                        id: this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'AddSiteUrlModalId' does not exist on typ... Remove this comment to see the full error message
                                                            .AddSiteUrlModalId,
                                                    });
                                                }}
                                                disabled={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMonitor' does not exist on type 'Rea... Remove this comment to see the full error message
                                                    this.props.editMonitor
                                                        .requesting
                                                }
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="addSiteUrlButton"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${this
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMonitor' does not exist on type 'Rea... Remove this comment to see the full error message
                                                    .props.editMonitor
                                                    .requesting &&
                                                    'bs-is-disabled'}`}
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '"save"' is not assignable to type '"reset" |... Remove this comment to see the full error message
                                                type="save"
                                                disabled={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMonitor' does not exist on type 'Rea... Remove this comment to see the full error message
                                                    this.props.editMonitor
                                                        .requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMonitor' does not exist on type 'Rea... Remove this comment to see the full error message
                                                        this.props.editMonitor
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
AddSiteUrl.displayName = 'AddSiteUrl';

const AddSiteUrlForm = reduxForm({
    form: 'AddSiteUrlForm',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(AddSiteUrl);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        AddSiteUrlModalId: state.modal.modals[0].id,
        editMonitor: state.monitor.editMonitor,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ closeModal, addSiteUrl }, dispatch);
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
AddSiteUrl.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    projectId: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    addSiteUrl: PropTypes.func.isRequired,
    AddSiteUrlModalId: PropTypes.string,
    editMonitor: PropTypes.object,
    data: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(AddSiteUrlForm);
