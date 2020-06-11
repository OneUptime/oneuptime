import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import { ValidateField } from '../../config';
import { Spinner } from '../basic/Loader';
import { closeModal } from '../../actions/modal';
import { addSiteUrl } from '../../actions/monitor';
import { RenderField } from '../basic/RenderField';

export class AddSiteUrl extends React.Component {
    // eslint-disable-next-line
    constructor(props) {
        super(props);
    }

    submitForm = values => {
        this.props
            .addSiteUrl(
                this.props.data.monitorId,
                this.props.projectId,
                values.url
            )
            .then(() => {
                return this.props.closeModal({
                    id: this.props.AddSiteUrlModalId,
                });
            });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.props.AddSiteUrlModalId,
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
                                            <span>Add New Site URL</span>
                                        </span>
                                    </div>
                                    <div className="bs-Modal-messages">
                                        <ShouldRender
                                            if={this.props.editMonitor.error}
                                        >
                                            <p className="bs-Modal-message">
                                                {this.props.editMonitor.error}
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
                                            this.props.editMonitor.requesting
                                        }
                                        validate={[
                                            ValidateField.required,
                                            ValidateField.url,
                                        ]}
                                    />
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className={`bs-Button bs-DeprecatedButton ${this
                                                .props.editMonitor.requesting &&
                                                'bs-is-disabled'}`}
                                            type="button"
                                            onClick={() => {
                                                this.props.closeModal({
                                                    id: this.props
                                                        .AddSiteUrlModalId,
                                                });
                                            }}
                                            disabled={
                                                this.props.editMonitor
                                                    .requesting
                                            }
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id="addSiteUrlButton"
                                            className={`bs-Button bs-DeprecatedButton bs-Button--blue ${this
                                                .props.editMonitor.requesting &&
                                                'bs-is-disabled'}`}
                                            type="save"
                                            disabled={
                                                this.props.editMonitor
                                                    .requesting
                                            }
                                        >
                                            <ShouldRender
                                                if={
                                                    this.props.editMonitor
                                                        .requesting
                                                }
                                            >
                                                <Spinner />
                                            </ShouldRender>
                                            <span>Add</span>
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

AddSiteUrl.displayName = 'AddSiteUrl';

const AddSiteUrlForm = reduxForm({
    form: 'AddSiteUrlForm',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(AddSiteUrl);

const mapStateToProps = state => {
    return {
        projectId:
            state.project.currentProject !== null &&
            state.project.currentProject._id,
        AddSiteUrlModalId: state.modal.modals[0].id,
        editMonitor: state.monitor.editMonitor,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ closeModal, addSiteUrl }, dispatch);
};

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
