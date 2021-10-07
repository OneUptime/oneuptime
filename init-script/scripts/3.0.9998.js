const { find, update } = require('../util/db');

const certificateCollection = 'certificates';

// run this to update the cert adding the chain to the certificate
async function run() {
    const certificates = await find(certificateCollection, { deleted: false });

    for (const certificate of certificates) {
        if (certificate.cert) {
            const fullCert = certificate.cert + '\n' + '\n' + certificate.chain;

            await update(
                certificateCollection,
                { _id: certificate._id },
                { cert: fullCert }
            );
        }
    }

    return `Script completed`;
}

module.exports = run;
