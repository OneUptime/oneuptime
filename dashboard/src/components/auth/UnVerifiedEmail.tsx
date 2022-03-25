import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';
import { sendEmailVerificationLink } from '../../actions/profile';
import { ListLoader } from '../basic/Loader';

interface UnVerifiedEmailBoxProps {
    initialValues?: object;
    emailVerificationRequesting?: boolean;
    emailVerificationError?: object;
    emailVerificationData?: object;
    sendEmailVerificationLink: Function;
}

class UnVerifiedEmailBox extends Component<UnVerifiedEmailBoxProps> {
    handleSendEmailVerification = () => {

        const { email } = this.props.initialValues;

        this.props.sendEmailVerificationLink({ email });
    };

    override render() {
        const {

            emailVerificationRequesting,

            emailVerificationError,

            emailVerificationData,

            initialValues,
        } = this.props;
        let initialUserEmail;
        let email;

        if (initialValues) {

            initialUserEmail = this.props.initialValues.email;
            email = initialUserEmail;
            if (emailVerificationData.data) {
                email = emailVerificationData.data.split('been sent to ')[1];
            }
        }

        return (
            <div className="Box-root Margin-vertical--12">
                <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                    <div className="Box-root Box-background--red4 Card-shadow--medium Border-radius--4">
                        {((!emailVerificationError &&
                            !emailVerificationRequesting &&
                            !emailVerificationData.data) ||
                            initialUserEmail !== email) && (
                                <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                    <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                        <span>
                                            Your email is not verified, Please click
                                            the resend button if you did not receive
                                            a verification link or check your email.
                                        </span>
                                    </span>
                                    <button
                                        className="bs-Button bs-Button--grey"
                                        disabled={emailVerificationRequesting}
                                        type="button"
                                        onClick={this.handleSendEmailVerification}
                                    >
                                        <span>Resend email verification.</span>
                                        {emailVerificationRequesting && (
                                            <ListLoader />
                                        )}
                                    </button>
                                </div>
                            )}
                        {(emailVerificationError ||
                            emailVerificationData.data) &&
                            !emailVerificationRequesting &&
                            initialUserEmail === email && (
                                <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                    <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                        {emailVerificationData.data ? (
                                            <span>
                                                {emailVerificationData.data}{' '}
                                                please check your email to
                                                verify your account
                                            </span>
                                        ) : emailVerificationError ? (
                                            <span>
                                                {emailVerificationError}
                                            </span>
                                        ) : null}
                                    </span>
                                </div>
                            )}
                    </div>
                </div>
            </div>
        );
    }
}

function mapStateToProps(state: $TSFixMe) {
    return {
        initialValues: state.profileSettings.profileSetting
            ? state.profileSettings.profileSetting.data
            : {},
        emailVerificationError:
            state.profileSettings.emailVerificationResult.error,
        emailVerificationData:
            state.profileSettings.emailVerificationResult.data,
        emailVerificationRequesting:
            state.profileSettings.emailVerificationResult.requesting,
    };
}

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ sendEmailVerificationLink }, dispatch);


UnVerifiedEmailBox.displayName = 'UnVerifiedEmailBox';


UnVerifiedEmailBox.propTypes = {
    initialValues: PropTypes.object,
    emailVerificationRequesting: PropTypes.bool,
    emailVerificationError: PropTypes.object,
    emailVerificationData: PropTypes.object,
    sendEmailVerificationLink: PropTypes.func.isRequired,
};

export default React.memo(
    connect(mapStateToProps, mapDispatchToProps)(UnVerifiedEmailBox)
);
