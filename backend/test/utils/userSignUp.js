module.exports = {
    createUser: function(request, userData, callback) {
        request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            email: userData.email,
            companyName: userData.companyName
        }).end(function (err, res) {
            stripe.paymentIntents.confirm(res.body.id, function( err, paymentIntent) {
                request.post('/user/signup').send({
                    paymentIntent: {
                        id: paymentIntent.id
                    },
                    ...userData
                }).end(function (err, res) {
                    return callback(err, res);
                });
            });
        });
    }
};

var payment = require('../../backend/config/payment');
var stripe = require('stripe')(payment.paymentPrivateKey);
