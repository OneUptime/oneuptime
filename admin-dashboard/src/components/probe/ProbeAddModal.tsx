import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { Field, reduxForm } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import { addProbe, resetAddProbe } from '../../actions/probe';

class ProbeAddModal extends Component<ComponentProps> {

    public static propTypes = {};

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {

        const { addProbe, closeThisDialog, resetAddProbe } = this.props;
        addProbe(values.probe_key, values.probe_name).then(
            function (val: $TSFixMe) {
                if (val === 'ok') {
                    resetAddProbe();
                    closeThisDialog();
                }
            },
            function () {
                //do nothing.
            }
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                this.props.resetAddProbe();

                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    override render() {
        const {

            handleSubmit,

            closeThisDialog,

            addProbeState,

            probes,

            resetAddProbe,
        } = this.props;
        const disabled = addProbeState.requesting || probes.requesting;
        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Add New Probe</span>
                                    </span>
                                </div>
                            </div>
                            <form
                                id="frmIncident"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-content bs-u-paddingless">
                                    <div className="bs-Modal-block bs-u-paddingless">
                                        <div className="bs-Modal-content">
                                            <span className="bs-Fieldset">
                                                <div className="bs-Fieldset-rows">
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            <span>
                                                                Probe Name
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                name="probe_name"
                                                                id="probe_name"
                                                                placeholder="US WEST"
                                                                disabled={
                                                                    disabled
                                                                }
                                                                validate={
                                                                    ValidateField.text
                                                                }
                                                                autoFocus={true}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            <span>
                                                                Probe Key
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                name="probe_key"
                                                                id="probe_key"
                                                                placeholder="abcde-qw345-awqert-456yu"
                                                                disabled={
                                                                    disabled
                                                                }
                                                                validate={
                                                                    ValidateField.text
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={
                                                addProbeState &&
                                                addProbeState.error
                                            }
                                        >
                                            <div className="bs-Tail-copy">
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
                                                            {
                                                                addProbeState.error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() => {
                                                resetAddProbe();
                                                closeThisDialog();
                                            }}
                                            disabled={disabled}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="add_probe"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={disabled}
                                            type="submit"
                                        >
                                            {addProbeState &&
                                                !addProbeState.requesting && (
                                                    <>
                                                        <span>Create</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                            {addProbeState &&
                                                addProbeState.requesting && (
                                                    <FormLoader />
                                                )}
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


ProbeAddModal.displayName = 'ProbeAddFormModal';

const ProbeAddModalForm = reduxForm({
    form: 'AddProbe', // a unique identifier for this form
})(ProbeAddModal);

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({ addProbe, resetAddProbe }, dispatch);
};

function mapStateToProps(state: $TSFixMe) {
    return {
        addProbeState: state.probe.addProbe,
        probes: state.probe.probes,
    };
}


ProbeAddModal.propTypes = {
    addProbe: PropTypes.func,
    addProbeState: PropTypes.object,
    closeThisDialog: PropTypes.func.isRequired,
    error: PropTypes.object,
    handleSubmit: PropTypes.func,
    probes: PropTypes.object,
    requesting: PropTypes.bool,
    resetAddProbe: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(ProbeAddModalForm);
