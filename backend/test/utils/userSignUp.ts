export default {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'request' implicitly has an 'any' type.
    createUser: function(request, userData, callback) {
        return new Promise((resolve, reject) => {
            request
                .post('/stripe/checkCard')
                .send({
                    tokenId: 'tok_visa',
                    email: userData.email,
                    companyName: userData.companyName,
                })
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                .end(function(err, res) {
                    if (err) {
                        if (callback) {
                            return callback(err, res);
                        }
                        return reject(err);
                    }
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'paymentIntents' does not exist on type '... Remove this comment to see the full error message
                    stripe.paymentIntents.confirm(res.body.id, function(
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                        err,
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'paymentIntent' implicitly has an 'any' ... Remove this comment to see the full error message
                        paymentIntent
                    ) {
                        if (err) {
                            if (callback) {
                                return callback(err, res);
                            }
                            return reject(err);
                        }
                        request
                            .post('/user/signup')
                            .send({
                                paymentIntent: {
                                    id: paymentIntent.id,
                                },
                                ...userData,
                            })
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                            .end(function(err, res) {
                                if (callback) {
                                    return callback(err, res);
                                } else {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(res);
                                    }
                                }
                            });
                    });
                });
        });
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'request' implicitly has an 'any' type.
    createEnterpriseUser: function(request, userData, callback) {
        request
            .post('/user/signup')
            .send(userData)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                return callback(err, res);
            });
    },
};

import payment from '../../backend/config/payment'
import stripe from 'stripe')(payment.paymentPrivateKey
