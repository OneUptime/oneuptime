import React from 'react';
import {
    CardElement,
    StripeProvider,
    Elements,
    injectStripe,
} from 'react-stripe-elements';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { bindActionCreators } from 'redux';
import { closeModal } from '../../actions/modal';
import { addCardFailed, addCardSuccess, addCardRequest } from '../../actions/card';
import { connect } from 'react-redux';
import { postApi, deleteApi, getApi } from '../../api';
import { env } from '../../config';

const createOptions = (fontSize, padding) => {
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

    handleSubmit = async (e) => {
        const { projectId, stripe, addCardSuccess, addCardFailed, addCardRequest } = this.props;
        e.preventDefault();
        var cardId = '';
        var tok = {};
        if (stripe) {
            addCardRequest()
            stripe
                .createToken()
                .then(({ token }) => {
                    if (token) {
                        tok = token;
                        return postApi(`stripe/${projectId}/creditCard/${token.id}/pi`);
                    }
                    else {
                        throw new Error('Invalid card Details.');
                    }
                })
                .then(({ data }) => stripe.handleCardPayment(data.client_secret))
                .then(result => {
                    if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
                        cardId = result.paymentIntent && result.paymentIntent.source;
                        return getApi(`stripe/${projectId}/creditCard/${cardId}`)
                    }
                    else {
                        cardId = tok.card && tok.card.id;
                        deleteApi(`stripe/${projectId}/creditCard/${cardId}`);
                        throw new Error(result.error.message);
                    }
                })
                .then(({ data }) => {
                    addCardSuccess(data);
                    this.props.closeModal({
                        id: this.props.CreateCardModalId
                    });
                })
                .catch((error) => {
                    addCardFailed(error.message)
                });
        } else {
            this.props.addCardFailed('Network Error, please try again later.')
        }
    };
    render() {
        const {
            requesting, error, elementFontSize
        } = this.props;
        return (
            <form onSubmit={this.handleSubmit}>
                <div onKeyDown={this.handleKeyBoard} className="ModalLayer-contents" tabIndex="-1" style={{ marginTop: '40px' }}>
                    <div className="bs-BIM">
                        <div className="bs-Modal" style={{ width: 500 }}>
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy"
                                    style={{ marginBottom: '10px', marginTop: '10px' }}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Add Card</span>
                                    </span>
                                    <p>
                                        <span>
                                            We will charge 1$ to make sure this card is billable.
                                        </span>
                                    </p>
                                </div>
                            </div>
                            <div className="bs-Modal-content Padding-horizontal--12">
                                <div className="bs-Modal-block bs-u-paddingless">
                                    <div className="bs-Modal-content">
                                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                            <label>
                                                <CardElement
                                                    {...createOptions(elementFontSize)}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions" style={{ width: 280 }}>
                                    <ShouldRender if={error}>
                                        <div className="bs-Tail-copy">
                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                                    </div>
                                                </div>
                                                <div className="Box-root">
                                                    <span style={{ color: 'red' }}>{error}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                </div>
                                <button className="bs-Button bs-DeprecatedButton" type="button" onClick={() => this.props.closeModal({
                                    id: this.props.CreateCardModalId
                                })}>
                                    <span>Cancel</span></button>
                                <button
                                    id="addCardButtonSubmit"
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={requesting}
                                    type="submit">
                                    {!requesting && <span>Add</span>}
                                    {requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

_CardForm.displayName = '_CardForm';

_CardForm.propTypes = {
    projectId: PropTypes.string,
    stripe: PropTypes.object,
    addCardSuccess: PropTypes.func.isRequired,
    addCardFailed: PropTypes.func.isRequired,
    addCardRequest: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    CreateCardModalId: PropTypes.string,
    requesting: PropTypes.bool,
    error: PropTypes.string,
    elementFontSize: PropTypes.number
}

const mapStateToProps = (state) => {
    return {
        CreateCardModalId: state.modal.modals[0].id,
        projectId: state.project.currentProject !== null && state.project.currentProject._id,
        error: state.card.addCard.error,
        requesting: state.card.addCard.requesting,
        paymentIntent: state.card.addCard.card
    }
}
const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ closeModal, addCardSuccess, addCardFailed, addCardRequest }, dispatch)
}
const CardForm = injectStripe(connect(mapStateToProps, mapDispatchToProps)(_CardForm));

class AddCard extends React.Component {
    constructor() {
        super();
        this.state = {
            elementFontSize: window.innerWidth < 450 ? '14px' : '18px',
        };
        window.addEventListener('resize', () => {
            if (window.innerWidth < 450 && this.state.elementFontSize !== '14px') {
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