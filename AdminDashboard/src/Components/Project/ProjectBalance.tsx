import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { reduxForm, Field, reset } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import { Validate } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import { updateBalance } from '../../actions/project';
import { RenderField } from '../basic/RenderField';
import PropTypes from 'prop-types';
import { openModal } from 'CommonUI/actions/modal';
import MessageBox from '../modals/MessageBox';

import { v4 as uuidv4 } from 'uuid';
import ConfirmBalanceTopUp from '../modals/ConfirmBalanceTopUp';
import DataPathHoC from '../DataPathHoC';

function validate(value: $TSFixMe) {
    const errors = {};

    if (!Validate.text(value.rechargeBalanceAmount)) {

        errors.rechargeBalanceAmount = 'Amount is required';
    } else if (!Validate.number(value.rechargeBalanceAmount)) {

        errors.rechargeBalanceAmount = 'Enter a valid number';
    } else if (!Validate.numberGreaterThanZero(value.rechargeBalanceAmount)) {

        errors.rechargeBalanceAmount = 'Enter a valid number greater than 0';
    }

    return errors;
}

class ProjectBalance extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    state = {
        MessageBoxId: uuidv4(),
        createTopUpModalId: uuidv4(),
    };
    submitForm = (values: $TSFixMe) => {

        const { openModal } = this.props;

        const { createTopUpModalId } = this.state;
        const { rechargeBalanceAmount } = values;
        if (rechargeBalanceAmount) {
            openModal({
                id: createTopUpModalId,
                onClose: () => '',
                onConfirm: () => this.updateProjectBalance(values),
                content: DataPathHoC(ConfirmBalanceTopUp, {
                    amount: values.rechargeBalanceAmount,

                    isRequesting: this.props.isRequesting,
                }),
            });
        }
    };
    updateProjectBalance = (values: $TSFixMe) => {

        const { updateBalance, projectId, openModal } = this.props;
        const { MessageBoxId } = this.state;
        return updateBalance(projectId, values.rechargeBalanceAmount)
            .then((response: $TSFixMe) => {
                const { balance } = response.data;
                openModal({
                    id: MessageBoxId,
                    content: MessageBox,
                    title: 'Message',
                    message: `Transaction successful, your balance is now ${balance.toFixed(
                        2
                    )}$`,
                });
            })
            .catch((err: $TSFixMe) => {
                openModal({
                    id: MessageBoxId,
                    content: MessageBox,
                    title: 'Message',
                    message: err.message,
                });
            });
    };

    override render() {

        const { balance } = this.props;
        return (
            <div className="Box-root Margin-vertical--12">
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Project Balance</span>
                                        </span>
                                        <p>
                                            <span>
                                                This balance will be use to send
                                                SMS and call alerts.
                                            </span>
                                        </p>
                                    </div>
                                </div>
                                <form

                                    onSubmit={this.props.handleSubmit(
                                        this.submitForm
                                    )}
                                >
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{ flex: '30% 0 0' }}
                                                >
                                                    <span></span>
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div
                                                        className="Box-root"
                                                        style={{
                                                            height: '5px',
                                                        }}
                                                    ></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <label>
                                                                    This balance
                                                                    will be used
                                                                    to send SMS
                                                                    and Call
                                                                    alerts. If
                                                                    the balance
                                                                    is below a
                                                                    certain
                                                                    criteria,
                                                                    alerts will
                                                                    not be sent.
                                                                    <br />
                                                                    <br />
                                                                    Please make
                                                                    sure you
                                                                    have
                                                                    multiple
                                                                    backups
                                                                    cards added
                                                                    to OneUptime
                                                                    to ensure
                                                                    alert
                                                                    deliverability.
                                                                </label>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{ flex: '30% 0 0' }}
                                                >
                                                    <span></span>
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div
                                                        className="Box-root"
                                                        style={{
                                                            height: '5px',
                                                        }}
                                                    ></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <label>
                                                                    <p>
                                                                        Current
                                                                        balance:{' '}
                                                                        <span
                                                                            id="currentBalance"
                                                                            style={{
                                                                                fontWeight:
                                                                                    'bold',
                                                                            }}
                                                                        >{`${Number.parseFloat(
                                                                            balance
                                                                        ).toFixed(
                                                                            2
                                                                        )}$`}</span>
                                                                    </p>
                                                                </label>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Update balance{' '}
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={RenderField}
                                                        type="text"
                                                        name="rechargeBalanceAmount"
                                                        id="rechargeBalanceAmount"
                                                        placeholder="Enter amount"
                                                        required="required"
                                                        disabled={
                                                            this.props

                                                                .isRequesting
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                        <span className="db-SettingsForm-footerMessage"></span>
                                        <div>
                                            <button
                                                id="rechargeAccount"
                                                className="bs-Button bs-Button--blue"
                                                disabled={

                                                    this.props.isRequesting
                                                }
                                                type="submit"
                                            >
                                                <ShouldRender
                                                    if={

                                                        !this.props.isRequesting
                                                    }
                                                >
                                                    <span>Update Balance</span>
                                                </ShouldRender>
                                                <ShouldRender

                                                    if={this.props.isRequesting}
                                                >
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


ProjectBalance.displayName = 'ProjectBalance';


ProjectBalance.propTypes = {
    updateBalance: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    projectId: PropTypes.string,
    balance: PropTypes.number,
    openModal: PropTypes.func,
};

const formName = 'CustomerBalance' + Math.floor(Math.random() * 10 + 1);

const onSubmitSuccess = (result: $TSFixMe, dispatch: Dispatch) => dispatch(reset(formName));

const ProjectBalanceForm = new reduxForm({
    form: formName,
    enableReinitialize: true,
    validate,
    onSubmitSuccess,
})(ProjectBalance);

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ openModal, updateBalance }, dispatch);

export default connect(null, mapDispatchToProps)(ProjectBalanceForm);
