export default {
    createUser: function (request, userData, callback): void {
        return new Promise((resolve, reject) => {
            request
                .post('/stripe/checkCard')
                .send({
                    tokenId: 'tok_visa',
                    email: userData.email,
                    companyName: userData.companyName,
                })

                .end((err, res): void => {
                    if (err) {
                        if (callback) {
                            return callback(err, res);
                        }
                        return reject(err);
                    }

                    stripe.paymentIntents.confirm(
                        res.body.id,
                        (
                            err,

                            paymentIntent
                        ) => {
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

                                .end((err, res): void => {
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
                        }
                    );
                });
        });
    },

    createEnterpriseUser: function (request, userData, callback): void {
        request
            .post('/user/signup')
            .send(userData)

            .end((err, res): void => {
                return callback(err, res);
            });
    },
};

import payment from '../../backend/config/payment';
import Stripe from 'stripe';
const stripe = Stripe(payment.paymentPrivateKey);
