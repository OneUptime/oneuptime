module.exports = {
    createUser: function(request, userData, callback) {
        return new Promise((resolve, reject) => {
            request
                .post('/stripe/checkCard')
                .send({
                    tokenId: 'tok_visa',
                    email: userData.email,
                    companyName: userData.companyName,
                })
                .end(function(err, res) {
                    stripe.paymentIntents.confirm(res.body.id, function(
                        err,
                        paymentIntent
                    ) {
                        request
                            .post('/user/signup')
                            .send({
                                paymentIntent: {
                                    id: paymentIntent.id,
                                },
                                ...userData,
                            })
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
    createEnterpriseUser: function(request, userData, callback) {
        request
            .post('/user/signup')
            .send(userData)
            .end(function(err, res) {
                return callback(err, res);
            });
    },
};

const payment = require('../../backend/config/payment');
const stripe = require('stripe')(payment.paymentPrivateKey);
