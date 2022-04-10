export default {
    user: process.env.TEST_EMAIL,
    pass: process.env.TEST_EMAIL_PASSWORD,
    host: process.env.TEST_EMAIL_SMTP_SERVER,
    port: process.env.TEST_EMAIL_SMTP_PORT,
    from: process.env.TEST_EMAIL,
    name: process.env.TEST_EMAIL_NAME,
    secure: true,
};
