import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm } from 'redux-form';
import UserForm from './UserForm';
import CardForm from './CardForm';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'quer... Remove this comment to see the full error message
import queryString from 'query-string';
import {
    signupUser,
    incrementStep,
    decrementStep,
    saveUserState,
    isUserInvited,
} from '../../actions/register';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';

import { IS_SAAS_SERVICE } from '../../config';

export class RegisterForm extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
    }

    userFormSubmitted = (values: $TSFixMe) => {
        const thisObj = this;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
        const token = queryString.parse(thisObj.props.location.search).token;
        values.token = token;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'saveUserState' does not exist on type 'R... Remove this comment to see the full error message
        this.props.saveUserState(values);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isUserInvited' does not exist on type 'R... Remove this comment to see the full error message
        this.props.isUserInvited(values).then(
            function(value: $TSFixMe) {
                if (value.data) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'signupUser' does not exist on type 'Read... Remove this comment to see the full error message
                    thisObj.props.signupUser({
                        ...values,
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'planId' does not exist on type 'Readonly... Remove this comment to see the full error message
                        planId: thisObj.props.planId,
                        token,
                    });
                } else {
                    if (!IS_SAAS_SERVICE) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'signupUser' does not exist on type 'Read... Remove this comment to see the full error message
                        thisObj.props.signupUser(values);
                    } else {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incrementStep' does not exist on type 'R... Remove this comment to see the full error message
                        thisObj.props.incrementStep();
                    }
                }
            },
            function(error: $TSFixMe) {
                return error;
            }
        );
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
        const { step } = this.props.register;
        return (
            <Fade>
                <div>
                    {step === 1 && (
                        <UserForm
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ submitForm: (values: any) => void; error: ... Remove this comment to see the full error message
                            submitForm={this.userFormSubmitted}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                            error={this.props.register.error}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
                            location={this.props.location}
                        />
                    )}
                    {step === 2 && (
                        <CardForm
                            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                            planId={this.props.planId}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                            error={this.props.register.error}
                        />
                    )}
                </div>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
RegisterForm.displayName = 'RegisterForm';

const registerForm = reduxForm({
    form: 'RegisterForm',
})(RegisterForm);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            signupUser,
            incrementStep,
            decrementStep,
            saveUserState,
            isUserInvited,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    return {
        register: state.register,
    };
}
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
RegisterForm.propTypes = {
    saveUserState: PropTypes.func.isRequired,
    isUserInvited: PropTypes.func.isRequired,
    register: PropTypes.object.isRequired,
    planId: PropTypes.string,
    location: PropTypes.object.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(registerForm);
