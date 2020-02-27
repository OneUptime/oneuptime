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
import { setTwoFactorAuth, verifyTwoFactorAuthToken, generateTwoFactorQRCode } from '../../actions/profile';


class TwoFactorAuthModal extends Component {
	state = {next: false}

	async componentDidMount() {
		const { profileSettings: { data }, generateTwoFactorQRCode } = this.props;
		generateTwoFactorQRCode(data.id);
	}

    handleKeyBoard = (e) => {
        const { twoFactorAuthId, closeModal } = this.props;
        switch (e.key) {
            case 'Escape':
                return closeModal({
                    id: twoFactorAuthId
                })
            default:
                return false;
        }
	}

	nextHandler = () => {
		this.setState({ next: true});
	}

	submitForm = (values) => {
		const { twoFactorAuthId, closeModal } = this.props;
		if (values.token) {
			const { setTwoFactorAuth, verifyTwoFactorAuthToken, profileSettings } = this.props;
			values.userId = profileSettings.data.id;
			verifyTwoFactorAuthToken(values).then((response) => {
				setTwoFactorAuth(response.data.twoFactorAuthEnabled);
				return closeModal({
                    id: twoFactorAuthId
                });
			})
		}
    }
	
	render() {
		const { handleSubmit, qrCode, twoFactorAuthSetting } = this.props;
		const { next } = this.state;

        return (
            <form onSubmit={handleSubmit(this.submitForm)}>
                <div onKeyDown={this.handleKeyBoard} className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                    <div className="ModalLayer-contents" tabIndex={-1} style={{ marginTop: 40 }}>
                        <div className="bs-BIM">
                            <div className="bs-Modal bs-Modal--medium">
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Two Factor Authentication</span>
                                        </span>
                                    </div>
                                    <div className="bs-Modal-messages">
                                        <ShouldRender if={twoFactorAuthSetting.error}>
                                            <p className="bs-Modal-message">{twoFactorAuthSetting.error}</p>
                                        </ShouldRender>
                                    </div>
                                </div>
								<div>
									<div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
										<div className="bs-u-paddingless">
											<div className="bs-Modal-block">
												<div>
												{next ? 
													<div>
														<div className="bs-Fieldset-wrapper Box-root" style={{width: '90%', margin: '1px 0 6px 2%'}}>
															<p >Input a token from your mobile device to complete setup</p>
														</div>
														<div className='bs-Modal-body'>
															<Field
																className="bs-TextInput"
																component={RenderField}
																name="token"
																id="token"
																placeholder="Verification token"
																disabled={twoFactorAuthSetting.requesting}
																style={{width: '90%', margin: '5px 0 10px 2%'}}
															/>
														</div>
													</div>
													: 	<div className="bs-Fieldset-wrapper Box-root">
															<div className="bs-Fieldset-wrapper Box-root" style={{ marginBottom: '10px', marginTop: '-5px' }}>
																<p>
																	Download the Google Authenticator Mobile app on your mobile device
																	<span> (<a href='https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2&hl=en'>Android</a>, 
																		<a href='https://apps.apple.com/us/app/google-authenticator/id388497605'> IOS</a>) 
																	</span> and then scan the QR code below to set up Two-factor Authentication with an Authenticator app.
																</p>
															</div>
															{qrCode.data.otpauth_url ?
																<QRCode size={230} value={`${qrCode.data.otpauth_url}`} style={{ 'margin': '0 0 0 21%' }}/> :
																<ListLoader />
															}
														</div>
												}
												</div>
											</div>
										</div>
									</div>
								</div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className={`bs-Button bs-DeprecatedButton ${twoFactorAuthSetting.requesting && 'bs-is-disabled'}`}
                                            type="button"
                                            onClick={() => {
                                                this.props.closeModal({
                                                    id: this.props.twoFactorAuthId
                                                })
                                            }}
                                            disabled={twoFactorAuthSetting.requesting}
                                        >
                                            <span>Cancel</span>
                                        </button>
										{!next ? 
											<button
												id="nextFormButton"
												className={`bs-Button bs-DeprecatedButton bs-Button--blue ${twoFactorAuthSetting.requesting && 'bs-is-disabled'}`}
												disabled={twoFactorAuthSetting.requesting}
												onClick={this.nextHandler}
												type="button"
											>
												<ShouldRender if={twoFactorAuthSetting.requesting}>
													<Spinner />
												</ShouldRender>
												<span>Next</span>
											</button>: 
											<button
												id="enableTwoFactorAuthButton"
												className={`bs-Button bs-DeprecatedButton bs-Button--blue ${twoFactorAuthSetting.requesting && 'bs-is-disabled'}`}
												type="submit"
												disabled={twoFactorAuthSetting.requesting}
											>
												<ShouldRender if={twoFactorAuthSetting.requesting}>
													<Spinner />
												</ShouldRender>
												<span>Verify</span>
											</button>
										}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        )
	}
}

TwoFactorAuthModal.displayName = 'TwoFactorAuthModal';

const TwoFactorAuthForm = reduxForm({
    form: 'TwoFactorAuthForm',
})(TwoFactorAuthModal);

TwoFactorAuthModal.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
	closeModal: PropTypes.func.isRequired,
	generateTwoFactorQRCode: PropTypes.func,
	setTwoFactorAuth: PropTypes.func,
	profileSettings: PropTypes.object,
	qrCode: PropTypes.object,
	twoFactorAuthId: PropTypes.string,
	twoFactorAuthSetting: PropTypes.object,
	verifyTwoFactorAuthToken: PropTypes.func,
}

const mapStateToProps = state => {
    return {
		profileSettings: state.profileSettings.profileSetting,
		qrCode: state.profileSettings.qrCode,
		twoFactorAuthSetting: state.profileSettings.twoFactorAuthSetting,
    }
}

const mapDispatchToProps = dispatch => bindActionCreators(
    { closeModal, setTwoFactorAuth, verifyTwoFactorAuthToken, generateTwoFactorQRCode }, dispatch
)

export default connect(mapStateToProps, mapDispatchToProps)(TwoFactorAuthForm);
