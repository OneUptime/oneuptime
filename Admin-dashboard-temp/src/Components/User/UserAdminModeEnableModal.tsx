import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

import { reduxForm, Field } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';

const formName = 'UserAdminModeEnableForm';

class UserAdminModeEnableModal extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    submitForm = (values: $TSFixMe) => {

        return this.props.confirmThisDialog(values);
    };

    handleKeyboard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':

                return document.getElementById('enableAdminMode').click();
            default:
                return false;
        }
    };

    override render() {
        const {

            isRequesting,

            enableAdminModeError,

            closeThisDialog,

            handleSubmit,
        } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Enable Admin Mode</span>
                                        </span>
                                    </div>
                                </div>
                                <form
                                    id={formName}
                                    onSubmit={handleSubmit(this.submitForm)}
                                >
                                    <div className="bs-Modal-content">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            Enter a temporary password (min. 6
                                            characters) to use in Admin mode
                                        </span>
                                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                            <fieldset className="Margin-bottom--16">
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="temporaryPassword"
                                                    >
                                                        <span>
                                                            Temporary Password
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="text"
                                                            name={
                                                                'temporaryPassword'
                                                            }
                                                            placeholder="Enter Password"
                                                            disabled={
                                                                isRequesting
                                                            }
                                                            validate={
                                                                ValidateField.password6
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </fieldset>
                                        </div>
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <ShouldRender
                                                if={enableAdminModeError}
                                            >
                                                <div className="bs-Tail-copy">
                                                    <div
                                                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                        style={{
                                                            marginTop: '10px',
                                                        }}
                                                    >
                                                        <div className="Box-root Margin-right--8">
                                                            <div
                                                                className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                                                style={{
                                                                    marginTop:
                                                                        '2px',
                                                                }}
                                                            ></div>
                                                        </div>
                                                        <div className="Box-root">
                                                            <span
                                                                style={{
                                                                    color:
                                                                        'red',
                                                                }}
                                                            >
                                                                {
                                                                    enableAdminModeError
                                                                }
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                            <button
                                                className={`bs-Button btn__modal ${isRequesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={closeThisDialog}
                                                disabled={isRequesting}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="enableAdminMode"
                                                className={`bs-Button bs-Button--red Box-background--red btn__modal ${isRequesting &&
                                                    'bs-is-disabled'}`}
                                                type="submit"
                                                disabled={isRequesting}
                                                autoFocus={true}
                                            >
                                                <ShouldRender if={isRequesting}>
                                                    <Spinner />
                                                </ShouldRender>
                                                <span>Enable Admin Mode</span>
                                                <span className="delete-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


UserAdminModeEnableModal.displayName = 'UserAdminModeEnableModal';

const mapStateToProps = (state: RootState) => {
    return {
        isRequesting:
            state.user &&
            state.user.enableAdminMode &&
            state.user.enableAdminMode.requesting,
        enableAdminModeError:
            state.user &&
            state.user.enableAdminMode &&
            state.user.enableAdminMode.error,
    };
};


UserAdminModeEnableModal.propTypes = {
    isRequesting: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.oneOf([null, undefined]),
    ]),
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func,
    enableAdminModeError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    handleSubmit: PropTypes.func,
};

const UserAdminModeEnableForm = reduxForm({
    form: formName,
    enableReinitialize: false,
    destroyOnUnmount: true,
})(UserAdminModeEnableModal);

export default connect(mapStateToProps)(UserAdminModeEnableForm);
