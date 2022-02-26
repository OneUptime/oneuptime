import React from 'react';
import {
    CardElement,
    StripeProvider,
    Elements,
    injectStripe,
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
} from 'react-stripe-elements';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { bindActionCreators } from 'redux';
import { closeModal } from '../../actions/modal';
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

class _CardForm extends React.Component {
    setRef: $TSFixMe;
    constructor() {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1-2 arguments, but got 0.
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
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('addCardButtonSubmit').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'CreateCardModalId' does not exist on typ... Remove this comment to see the full error message
            id: this.props.CreateCardModalId,
        });
    };

    handleSubmit = async (e: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
            userId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'stripe' does not exist on type 'Readonly... Remove this comment to see the full error message
            stripe,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCardSuccess' does not exist on type '... Remove this comment to see the full error message
            addCardSuccess,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCardFailed' does not exist on type 'R... Remove this comment to see the full error message
            addCardFailed,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCardRequest' does not exist on type '... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'card' does not exist on type '{}'.
                        cardId = tok.card && tok.card.id;
                        return getApi(`stripe/${userId}/creditCard/${cardId}`);
                    } else {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'card' does not exist on type '{}'.
                        cardId = tok.card && tok.card.id;
                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
                        deleteApi(`stripe/${userId}/creditCard/${cardId}`);
                        throw new Error(result.error.message);
                    }
                })
                .then(({
                data
            }: $TSFixMe) => {
                    addCardSuccess(data);
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                    this.props.closeModal({
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'CreateCardModalId' does not exist on typ... Remove this comment to see the full error message
                        id: this.props.CreateCardModalId,
                    });
                })
                .catch((error: $TSFixMe) => {
                    addCardFailed(error.message);
                });
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCardFailed' does not exist on type 'R... Remove this comment to see the full error message
            this.props.addCardFailed('Network Error, please try again later.');
        }
    };
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
        const { requesting, error, elementFontSize } = this.props;
        return (
            <form onSubmit={this.handleSubmit}>
                <div
                    className="ModalLayer-contents"
                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                                            this.props.closeModal({
                                                id: this.props
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'CreateCardModalId' does not exist on typ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
_CardForm.displayName = '_CardForm';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
const mapDispatchToProps = (dispatch: $TSFixMe) => {
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
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1-2 arguments, but got 0.
        super();
        this.state = {
            elementFontSize: window.innerWidth < 450 ? '14px' : '18px',
        };
        window.addEventListener('resize', () => {
            if (
                window.innerWidth < 450 &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'elementFontSize' does not exist on type ... Remove this comment to see the full error message
                this.state.elementFontSize !== '14px'
            ) {
                this.setState({ elementFontSize: '14px' });
            } else if (
                window.innerWidth >= 450 &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'elementFontSize' does not exist on type ... Remove this comment to see the full error message
                this.state.elementFontSize !== '18px'
            ) {
                this.setState({ elementFontSize: '18px' });
            }
        });
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'elementFontSize' does not exist on type ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AddCard.displayName = 'AddCard';

export default AddCard;
