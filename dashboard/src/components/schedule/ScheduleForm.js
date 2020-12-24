import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { Spinner } from '../basic/Loader';
import { closeModal } from '../../actions/modal';
import { createSchedule } from '../../actions/schedule';

function validate(values) {
    const errors = {};

    if (!Validate.text(values.name)) {
        errors.name = 'Schedule Name is required!';
    }
    return errors;
}

export class ScheduleForm extends React.Component {
    // eslint-disable-next-line
    constructor(props) {
        super(props);
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        this.props
            .createSchedule(this.props.data.projectId, values)
            .then(() => {
                return this.props.closeModal({
                    id: this.props.scheduleModalId,
                });
            });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.props.scheduleModalId,
                });
            case 'Enter':
                return document.getElementById('btnCreateSchedule').click();
            default:
                return false;
        }
    };

    render() {
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
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Create New On-Call Duty</span>
                                        </span>
                                    </div>
                                    <div className="bs-Modal-messages">
                                        <ShouldRender
                                            if={
                                                this.props.schedule.newSchedule
                                                    .error
                                            }
                                        >
                                            <p className="bs-Modal-message">
                                                {
                                                    this.props.schedule
                                                        .newSchedule.error
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
                                        placeholder="Call Duty Name?"
                                        id="name"
                                        className="bs-TextInput"
                                        style={{
                                            width: '90%',
                                            margin: '10px 0 10px 5%',
                                        }}
                                        disabled={
                                            this.props.schedule.newSchedule
                                                .requesting
                                        }
                                        autoFocus={true}
                                    />
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className={`bs-Button bs-DeprecatedButton btn__modal ${this
                                                .props.schedule.newSchedule
                                                .requesting &&
                                                'bs-is-disabled'}`}
                                            type="button"
                                            onClick={() => {
                                                this.props.closeModal({
                                                    id: this.props
                                                        .scheduleModalId,
                                                });
                                            }}
                                            disabled={
                                                this.props.schedule.newSchedule
                                                    .requesting
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="btnCreateSchedule"
                                            className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${this
                                                .props.schedule.newSchedule
                                                .requesting &&
                                                'bs-is-disabled'}`}
                                            type="save"
                                            disabled={
                                                this.props.schedule.newSchedule
                                                    .requesting
                                            }
                                        >
                                            <ShouldRender
                                                if={
                                                    this.props.schedule
                                                        .newSchedule.requesting
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
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

ScheduleForm.displayName = 'ScheduleForm';

const CreateScheduleForm = reduxForm({
    form: 'ScheduleModalForm',
    validate,
})(ScheduleForm);

const mapStateToProps = state => {
    return {
        scheduleModalId: state.modal.modals[0].id,
        schedule: state.schedule,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ closeModal, createSchedule }, dispatch);
};

ScheduleForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    createSchedule: PropTypes.func.isRequired,
    scheduleModalId: PropTypes.string.isRequired,
    schedule: PropTypes.object,
    data: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(CreateScheduleForm);
