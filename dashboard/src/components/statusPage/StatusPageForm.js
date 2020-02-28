import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { Spinner } from '../basic/Loader';
import { closeModal } from '../../actions/modal';
import { createStatusPage } from '../../actions/statusPage';

function validate(values) {
    const errors = {};

    if (!Validate.text(values.name)) {
        errors.name = 'Status Page Name is required!';
    }
    return errors;
}

export class StatusPageForm extends React.Component {
    // eslint-disable-next-line
    constructor(props) {
        super(props);
    }

    submitForm = values => {
        values.monitorIds = [];
        const { data } = this.props;
        this.props.createStatusPage(data.projectId, values).then(() => {
            return this.props.closeModal({
                id: this.props.statusPageModalId,
            });
        });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.props.statusPageModalId,
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
                                            <span>Create New Status Page</span>
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
                                            this.props.statusPage.newStatusPage
                                                .requesting
                                        }
                                    />
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className={`bs-Button bs-DeprecatedButton ${this
                                                .props.statusPage.newStatusPage
                                                .requesting &&
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
                                                    .newStatusPage.requesting
                                            }
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id="btnCreateStatusPage"
                                            className={`bs-Button bs-DeprecatedButton bs-Button--blue ${this
                                                .props.statusPage.newStatusPage
                                                .requesting &&
                                                'bs-is-disabled'}`}
                                            type="save"
                                            disabled={
                                                this.props.statusPage
                                                    .newStatusPage.requesting
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

StatusPageForm.displayName = 'StatusPageForm';

const CreateStatusPageForm = reduxForm({
    form: 'StatusPageModalForm',
    validate,
})(StatusPageForm);

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
        statusPageModalId: state.modal.modals[0].id,
        statusPage: state.statusPage,
    };
};

const mapDispatchToProps = dispatch => {
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
