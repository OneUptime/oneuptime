module.exports = {
    algorithm: process.env['ENCRYPTION_ALGORYTHM'] || 'aes-256-cbc',
    key: process.env['ENCRYPTION_KEY'] || 'pg#K^C$-)IGOg6DYXDGq2jdmfws0MiR7',
    iv:
        process.env['ENCRYPTION_IV'] ||
        '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f',
};
