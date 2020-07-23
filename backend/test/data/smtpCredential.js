module.exports = {
    user: process.env.TEST_EMAIL,
    pass: process.env.TEST_EMAIL_PASSWORD,
    host: 'smtp.gmail.com',
    port: '465',
    from: process.env.TEST_EMAIL,
    secure: true,
};
