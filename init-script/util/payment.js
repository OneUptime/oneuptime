/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    paymentPrivateKey:
        process.env['STRIPE_PRIVATE_KEY'] || 'sk_test_YxwnzywggtAd8jDaHecNmHiN',
    paymentPublicKey:
        process.env['STRIPE_PUBLIC_KEY'] || 'pk_test_4I2S0sD0TYJxEWQTYlC2Rk6E',
};
