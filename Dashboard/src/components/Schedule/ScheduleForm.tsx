import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { reduxForm, Field } from 'redux-form';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import { Spinner } from '../basic/Loader';
import { closeModal } from 'CommonUI/actions/Modal';
import { createSchedule } from '../../actions/schedule';

function validate(values: $TSFixMe) {
    const errors: $TSFixMe = {};

    if (!Validate.text(values.name)) {

        errors.name = 'Schedule Name is required!';
    }
    return errors;
}

interface ScheduleFormProps {
    handleSubmit: Function;
    closeModal: Function;
    createSchedule: Function;
    scheduleModalId: string;
    schedule?: object;
    data?: object;
}

export class ScheduleForm extends React.Component<ScheduleFormProps> {
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
        this.props

            .createSchedule(this.props.data.projectId, values)
            .then(() => {

                return this.props.closeModal({

                    id: this.props.scheduleModalId,
                });
            });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document.getElementById('btnCreateSchedule').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.scheduleModalId,
        });
    };

    override render() {

        const { handleSubmit }: $TSFixMe = this.props;
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
                                                    Create New On-Call Duty
                                                </span>
                                            </span>
                                        </div>
                                        <div className="bs-Modal-messages">
                                            <ShouldRender
                                                if={

                                                    this.props.schedule
                                                        .newSchedule.error
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

                                                    this.props.schedule
                                                        .newSchedule.requesting
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

                                                    this.props.schedule
                                                        .newSchedule.requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={

                                                        this.props.schedule
                                                            .newSchedule
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


ScheduleForm.displayName = 'ScheduleForm';

const CreateScheduleForm: $TSFixMe = reduxForm({
    form: 'ScheduleModalForm',
    validate,
})(ScheduleForm);

const mapStateToProps: Function = (state: RootState) => {
    return {
        scheduleModalId: state.modal.modals[0].id,
        schedule: state.schedule,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
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
