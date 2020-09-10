module.exports = {
    algorithm: process.env['ENCRYPTION_ALGORITHM'] || 'aes-256-cbc',
    key: process.env['ENCRYPTION_KEY'],
};
