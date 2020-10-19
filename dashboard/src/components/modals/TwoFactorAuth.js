import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { reduxForm, Field } from 'redux-form';
import { Spinner } from '../basic/Loader';
import QRCode from 'qrcode.react';
import { RenderField } from '../basic/RenderField';
import { ListLoader } from '../basic/Loader.js';
import {
    setTwoFactorAuth,
    verifyTwoFactorAuthToken,
    generateTwoFactorQRCode,
} from '../../actions/profile';

class TwoFactorAuthModal extends Component {
    state = { next: false };

    async componentDidMount() {
        const {
            profileSettings: { data },
            generateTwoFactorQRCode,
        } = this.props;
        generateTwoFactorQRCode(data.id);

        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        const { next } = this.state;
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                if (next) {
                    return document
                        .getElementById('enableTwoFactorAuthButton')
                        .click();
                } else {
                    e.preventDefault(); // prevent default behaviour of trying to submit the form
                    return document.getElementById('nextFormButton').click();
                }
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        const { next } = this.state;
        if (next) {
            this.setState({ next: false });
        } else {
            this.props.closeThisDialog();
        }
    };

    nextHandler = e => {
        e.preventDefault();
        this.setState({ next: true });
    };

    submitForm = values => {
        const { twoFactorAuthId, closeModal } = this.props;
        if (values.token) {
            const {
                setTwoFactorAuth,
                verifyTwoFactorAuthToken,
                profileSettings,
            } = this.props;
            values.userId = profileSettings.data.id;
            verifyTwoFactorAuthToken(values).then(response => {
                setTwoFactorAuth(response.data.twoFactorAuthEnabled);
                this.props.closeThisDialog();
            });
        }
    };

    render() {
        const { handleSubmit, qrCode, twoFactorAuthSetting } = this.props;
        const { next } = this.state;

        return (
            <form onSubmit={handleSubmit(this.submitForm)}>
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
                                            <span>
                                                Two Factor Authentication
                                            </span>
                                        </span>
                                    </div>
                                    <div className="bs-Modal-messages">
                                        <ShouldRender
                                            if={twoFactorAuthSetting.error}
                                        >
                                            <p
                                                className="bs-Modal-message"
                                                id="modal-message"
                                            >
                                                {twoFactorAuthSetting.error}
                                            </p>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <div className="bs-u-paddingless">
                                            <div className="bs-Modal-block">
                                                <div>
                                                    {next ? (
                                                        <div>
                                                            <div
                                                                className="bs-Fieldset-wrapper Box-root"
                                                                style={{
                                                                    width:
                                                                        '90%',
                                                                    margin:
                                                                        '1px 0 6px 2%',
                                                                }}
                                                            >
                                                                <p>
                                                                    Input a
                                                                    token from
                                                                    your mobile
                                                                    device to
                                                                    complete
                                                                    setup
                                                                </p>
                                                            </div>
                                                            <div className="bs-Modal-body">
                                                                <Field
                                                                    className="bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    name="token"
                                                                    id="token"
                                                                    placeholder="Verification token"
                                                                    disabled={
                                                                        twoFactorAuthSetting.requesting
                                                                    }
                                                                    style={{
                                                                        width:
                                                                            '90%',
                                                                        margin:
                                                                            '5px 0 10px 2%',
                                                                    }}
                                                                    required={
                                                                        true
                                                                    }
                                                                    autoFocus={
                                                                        true
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="bs-Fieldset-wrapper Box-root">
                                                            <div
                                                                className="bs-Fieldset-wrapper Box-root"
                                                                style={{
                                                                    marginBottom:
                                                                        '10px',
                                                                    marginTop:
                                                                        '-5px',
                                                                }}
                                                            >
                                                                <p>
                                                                    Download the
                                                                    Google
                                                                    Authenticator
                                                                    Mobile app
                                                                    on your
                                                                    mobile
                                                                    device
                                                                    <span>
                                                                        {' '}
                                                                        (
                                                                        <a href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2&hl=en">
                                                                            Android
                                                                        </a>
                                                                        ,
                                                                        <a href="https://apps.apple.com/us/app/google-authenticator/id388497605">
                                                                            {' '}
                                                                            IOS
                                                                        </a>
                                                                        )
                                                                    </span>{' '}
                                                                    and then
                                                                    scan the QR
                                                                    code below
                                                                    to set up
                                                                    Two-factor
                                                                    Authentication
                                                                    with an
                                                                    Authenticator
                                                                    app.
                                                                </p>
                                                            </div>
                                                            {qrCode.data
                                                                .otpauth_url ? (
                                                                <QRCode
                                                                    size={230}
                                                                    value={`${qrCode.data.otpauth_url}`}
                                                                    imageSettings={{
                                                                        src:
                                                                            'data:image/svg+xml;base64,77u/PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+DQo8c3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHZlcnNpb249IjEuMSIgYmFzZVByb2ZpbGU9ImZ1bGwiIHdpZHRoPSIyNzkuODQ3IiBoZWlnaHQ9IjI3OS44NDciIHZpZXdCb3g9IjAgMCAyNzkuODUgMjc5Ljg1IiBlbmFibGUtYmFja2dyb3VuZD0ibmV3IDAgMCAyNzkuODUgMjc5Ljg1IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCgk8cmVjdCB4PSIwIiB5PSItNi4xMDM1MmUtMDA1IiBmaWxsPSI6IzAwMDAwMCIgZmlsbC1vcGFjaXR5PSIxIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiB3aWR0aD0iMjc5Ljg0NyIgaGVpZ2h0PSIyNzkuODQ3Ii8+DQoJPHBhdGggZmlsbD0iI0ZGRkZGRiIgZmlsbC1vcGFjaXR5PSIxIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJNIDIxMC42NDksMTAzLjUwMUMgMjA4LjQzMSwxMDIuNTczIDIwNS45MDEsMTAyLjEwOSAyMDMuMDU5LDEwMi4xMDlDIDE5NS4wODUsMTAyLjEwOSAxOTEuMDk3LDEwNi40MDggMTkxLjA5NywxMTUuMDA2TCAxOTEuMDk3LDEyNC4zNzlMIDIwNy44NjUsMTI0LjM3OUwgMjA3Ljg2NSwxMzYuOTA2TCAxOTEuMTYzLDEzNi45MDZMIDE5MS4xNjMsMTkzLjk3M0wgMTc1Ljg1MiwxOTMuOTczTCAxNzUuODUyLDEzNi45MDZMIDE2My4zMjUsMTM2LjkwNkwgMTYzLjMyNSwxMjQuMzc5TCAxNzUuODUyLDEyNC4zNzlMIDE3NS44NTIsMTEzLjE1N0MgMTc1Ljg1MiwxMDUuODY1IDE3OC4yNzcsMTAwLjExMiAxODMuMTI3LDk1LjkwMDNDIDE4Ny45NzcsOTEuNjg4NCAxOTQuMDQxLDg5LjU4MjYgMjAxLjMxOSw4OS41ODI2QyAyMDUuMjQ4LDg5LjU4MjYgMjA4LjM1OCw4OS45OTU4IDIxMC42NDksOTAuODIyMkwgMjEwLjY0OSwxMDMuNTAxIFogIi8+DQoJPHJlY3QgeD0iMjE3LjYwOCIgeT0iMTI0LjM3OSIgZmlsbD0iI0ZGRkZGRiIgZmlsbC1vcGFjaXR5PSIxIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiB3aWR0aD0iMTUuMzEwNSIgaGVpZ2h0PSI2OS41OTM0Ii8+DQoJPHBhdGggZmlsbD0iIzZDREI1NiIgZmlsbC1vcGFjaXR5PSIxIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJNIDEyOS42MDEsOTcuODE4TCAxNDQuMSw5Ny44MThDIDE0Ni4zMDksOTcuODE4IDE0OC4xLDk5LjYwODggMTQ4LjEsMTAxLjgxOEwgMTQ4LjEsMTg5LjgxM0MgMTQ4LjEsMTkyLjAyMiAxNDYuMzA5LDE5My44MTMgMTQ0LjEsMTkzLjgxM0wgMTI5LjYwMSwxOTMuODEzQyAxMjcuMzkyLDE5My44MTMgMTI1LjYwMSwxOTIuMDIyIDEyNS42MDEsMTg5LjgxM0wgMTI1LjYwMSwxMDEuODE4QyAxMjUuNjAxLDk5LjYwODggMTI3LjM5Miw5Ny44MTggMTI5LjYwMSw5Ny44MTggWiAiLz4NCgk8cGF0aCBmaWxsPSIjNkNEQjU2IiBmaWxsLW9wYWNpdHk9IjEiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGQ9Ik0gOTUuODUzMSw5OC41Njc3TCAxMTAuMzUyLDk4LjU2NzdDIDExMi41NjEsOTguNTY3NyAxMTQuMzUyLDEwMC4zNTggMTE0LjM1MiwxMDIuNTY4TCAxMTQuMzUyLDE5MC41NjNDIDExNC4zNTIsMTkyLjc3MiAxMTIuNTYxLDE5NC41NjMgMTEwLjM1MiwxOTQuNTYzTCA5NS44NTMxLDE5NC41NjNDIDkzLjY0NCwxOTQuNTYzIDkxLjg1MzEsMTkyLjc3MiA5MS44NTMxLDE5MC41NjNMIDkxLjg1MzEsMTAyLjU2OEMgOTEuODUzMSwxMDAuMzU4IDkzLjY0NCw5OC41Njc3IDk1Ljg1MzEsOTguNTY3NyBaICIvPg0KCTxwYXRoIGZpbGw9IiM2Q0RCNTYiIGZpbGwtb3BhY2l0eT0iMSIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0iTSA2MC4zNTUsOTguMDY3NEwgNzQuODUzOSw5OC4wNjc0QyA3Ny4wNjMsOTguMDY3NCA3OC44NTM5LDk5Ljg1ODMgNzguODUzOSwxMDIuMDY3TCA3OC44NTM5LDE5MC4wNjNDIDc4Ljg1MzksMTkyLjI3MiA3Ny4wNjMsMTk0LjA2MyA3NC44NTM5LDE5NC4wNjNMIDYwLjM1NSwxOTQuMDYzQyA1OC4xNDU4LDE5NC4wNjMgNTYuMzU1LDE5Mi4yNzIgNTYuMzU1LDE5MC4wNjNMIDU2LjM1NSwxMDIuMDY3QyA1Ni4zNTUsOTkuODU4MyA1OC4xNDU4LDk4LjA2NzQgNjAuMzU1LDk4LjA2NzQgWiAiLz4NCjwvc3ZnPg0K',
                                                                        height: 24,
                                                                        width: 24,
                                                                        excavate: true,
                                                                    }}
                                                                    style={{
                                                                        display:
                                                                            'block',
                                                                        margin:
                                                                            '0 auto',
                                                                    }}
                                                                />
                                                            ) : (
                                                                <ListLoader />
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className={`bs-Button bs-DeprecatedButton btn__modal ${twoFactorAuthSetting.requesting &&
                                                'bs-is-disabled'}`}
                                            type="button"
                                            onClick={() => {
                                                this.handleCloseModal();
                                            }}
                                            disabled={
                                                twoFactorAuthSetting.requesting
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        {!next ? (
                                            <button
                                                id="nextFormButton"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${twoFactorAuthSetting.requesting &&
                                                    'bs-is-disabled'}`}
                                                disabled={
                                                    twoFactorAuthSetting.requesting
                                                }
                                                onClick={this.nextHandler}
                                                type="button"
                                                autoFocus={true}
                                            >
                                                <ShouldRender
                                                    if={
                                                        twoFactorAuthSetting.requesting
                                                    }
                                                >
                                                    <Spinner />
                                                </ShouldRender>
                                                <span>Next</span>
                                                <span className="create-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </button>
                                        ) : (
                                            <button
                                                id="enableTwoFactorAuthButton"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${twoFactorAuthSetting.requesting &&
                                                    'bs-is-disabled'}`}
                                                type="submit"
                                                disabled={
                                                    twoFactorAuthSetting.requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        twoFactorAuthSetting.requesting
                                                    }
                                                >
                                                    <Spinner />
                                                </ShouldRender>
                                                <span>Verify</span>
                                                <span className="create-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </button>
                                        )}
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

TwoFactorAuthModal.displayName = 'TwoFactorAuthModal';

const TwoFactorAuthForm = reduxForm({
    form: 'TwoFactorAuthForm',
})(TwoFactorAuthModal);

TwoFactorAuthModal.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    generateTwoFactorQRCode: PropTypes.func,
    setTwoFactorAuth: PropTypes.func,
    profileSettings: PropTypes.object,
    qrCode: PropTypes.object,
    twoFactorAuthId: PropTypes.string,
    twoFactorAuthSetting: PropTypes.object,
    verifyTwoFactorAuthToken: PropTypes.func,
};

const mapStateToProps = state => {
    return {
        profileSettings: state.profileSettings.profileSetting,
        qrCode: state.profileSettings.qrCode,
        twoFactorAuthSetting: state.profileSettings.twoFactorAuthSetting,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            closeModal,
            setTwoFactorAuth,
            verifyTwoFactorAuthToken,
            generateTwoFactorQRCode,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(TwoFactorAuthForm);
