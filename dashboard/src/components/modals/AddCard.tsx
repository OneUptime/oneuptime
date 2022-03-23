import React from 'react';
import {
    CardElement,
    StripeProvider,
    Elements,
    injectStripe,

} from '@stripe/react-stripe-js';
import PropTypes from 'prop-types';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { bindActionCreators, Dispatch } from 'redux';
import { closeModal } from 'common-ui/actions/modal';
import {
    addCardFailed,
    addCardSuccess,
    addCardRequest,
} from '../../actions/card';
import { connect } from 'react-redux';
import { postApi, deleteApi, getApi } from '../../api';
import { env, User } from '../../config';

const createOptions = (fontSize: $TSFixMe, padding: $TSFixMe) => {
    return {
        style: {
            base: {
                fontSize,
                color: '#424770',
                letterSpacing: '0.025em',
                fontFamily: 'Source Code Pro, monospace',
                '::placeholder': {
                    color: '#aab7c4',
                },
                padding,
            },
            invalid: {
                color: '#9e2146',
            },
        },
    };
};

interface _CardFormProps {
    userId?: string;
    stripe?: object;
    addCardSuccess: Function;
    addCardFailed: Function;
    addCardRequest: Function;
    closeModal: Function;
    CreateCardModalId?: string;
    requesting?: boolean;
    error?: string;
    elementFontSize?: number;
}

class _CardForm extends React.Component<_CardFormProps> {
    setRef: $TSFixMe;
    constructor() {

        super();

        this.setRef = (instance: $TSFixMe) => {
            if (instance) {
                instance._element.on('ready', () => {
                    instance._element.focus();
                });
            }
        };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document.getElementById('addCardButtonSubmit').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.CreateCardModalId,
        });
    };

    handleSubmit = async (e: $TSFixMe) => {
        const {

            userId,

            stripe,

            addCardSuccess,

            addCardFailed,

            addCardRequest,
        } = this.props;
        e.preventDefault();
        let cardId = '';
        let tok = {};
        if (stripe) {
            addCardRequest();
            stripe
                .createToken()
                .then(({
                    token
                }: $TSFixMe) => {
                    if (token) {
                        tok = token;

                        return postApi(
                            `stripe/${userId}/creditCard/${token.id}/pi`
                        );
                    } else {
                        throw new Error('Invalid card Details.');
                    }
                })
                .then(({
                    data
                }: $TSFixMe) =>
                    stripe.handleCardPayment(data.client_secret)
                )
                .then((result: $TSFixMe) => {
                    if (
                        result.paymentIntent &&
                        result.paymentIntent.status === 'succeeded'
                    ) {
                        /**
                        After 'stripe.handleCardPayment' is called, paymentIntent.source equalled null.
                        However, the content of SOURCE prior to the handleCardPayment is 'card_1JFaaLIt5jR0TXkEUhiiuw5M' and this is the same as TOK.CARD.ID from token generated
                        */

                        cardId = tok.card && tok.card.id;
                        return getApi(`stripe/${userId}/creditCard/${cardId}`);
                    } else {

                        cardId = tok.card && tok.card.id;

                        deleteApi(`stripe/${userId}/creditCard/${cardId}`);
                        throw new Error(result.error.message);
                    }
                })
                .then(({
                    data
                }: $TSFixMe) => {
                    addCardSuccess(data);

                    this.props.closeModal({

                        id: this.props.CreateCardModalId,
                    });
                })
                .catch((error: $TSFixMe) => {
                    addCardFailed(error.message);
                });
        } else {

            this.props.addCardFailed('Network Error, please try again later.');
        }
    };
    render() {

        const { requesting, error, elementFontSize } = this.props;
        return (
            <form onSubmit={this.handleSubmit}>
                <div
                    className="ModalLayer-contents"

                    tabIndex="-1"
                    style={{ marginTop: '40px' }}
                >
                    <ClickOutside onClickOutside={this.handleCloseModal}>
                        <div className="bs-BIM">
                            <div className="bs-Modal">
                                <div className="bs-Modal-header">
                                    <div
                                        className="bs-Modal-header-copy"
                                        style={{
                                            marginBottom: '10px',
                                            marginTop: '10px',
                                        }}
                                    >
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Add Card</span>
                                        </span>
                                        <p>
                                            <span>
                                                We will charge 1$ to make sure
                                                this card is billable.
                                            </span>
                                        </p>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--20i">
                                        <label>
                                            <CardElement

                                                {...createOptions(
                                                    elementFontSize
                                                )}
                                                ref={this.setRef}
                                            />
                                        </label>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions Flex-flex--1"
                                        style={{ width: 280 }}
                                    >
                                        <ShouldRender if={error}>
                                            <div className="bs-Tail-copy Flex-flex--1">
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
                                                            id="cardError"
                                                        >
                                                            {error}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                    <button
                                        className="bs-Button bs-DeprecatedButton btn__modal"
                                        type="button"
                                        onClick={() =>

                                            this.props.closeModal({
                                                id: this.props

                                                    .CreateCardModalId,
                                            })
                                        }
                                    >
                                        <span>Cancel</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                    <button
                                        id="addCardButtonSubmit"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                        disabled={requesting}
                                        type="submit"
                                    >
                                        {!requesting && (
                                            <>
                                                <span>Add</span>
                                                <span className="create-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </>
                                        )}
                                        {requesting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </ClickOutside>
                </div>
            </form>
        );
    }
}


_CardForm.displayName = '_CardForm';


_CardForm.propTypes = {
    userId: PropTypes.string,
    stripe: PropTypes.object,
    addCardSuccess: PropTypes.func.isRequired,
    addCardFailed: PropTypes.func.isRequired,
    addCardRequest: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    CreateCardModalId: PropTypes.string,
    requesting: PropTypes.bool,
    error: PropTypes.string,
    elementFontSize: PropTypes.number,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        CreateCardModalId: state.modal.modals[0].id,
        error: state.card.addCard.error,
        requesting: state.card.addCard.requesting,
        paymentIntent: state.card.addCard.card,
        userId: User.getUserId(),
    };
};
const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        { closeModal, addCardSuccess, addCardFailed, addCardRequest },
        dispatch
    );
};
const CardForm = injectStripe(
    connect(mapStateToProps, mapDispatchToProps)(_CardForm)
);

class AddCard extends React.Component {
    constructor() {

        super();
        this.state = {
            elementFontSize: window.innerWidth < 450 ? '14px' : '18px',
        };
        window.addEventListener('resize', () => {
            if (
                window.innerWidth < 450 &&

                this.state.elementFontSize !== '14px'
            ) {
                this.setState({ elementFontSize: '14px' });
            } else if (
                window.innerWidth >= 450 &&

                this.state.elementFontSize !== '18px'
            ) {
                this.setState({ elementFontSize: '18px' });
            }
        });
    }

    render() {

        const { elementFontSize } = this.state;
        return (
            <StripeProvider apiKey={env('STRIPE_PUBLIC_KEY')}>
                <div className="Checkout">
                    <Elements>
                        <CardForm fontSize={elementFontSize} />
                    </Elements>
                </div>
            </StripeProvider>
        );
    }
}


AddCard.displayName = 'AddCard';

export default AddCard;
