const { find, save, update, removeField } = require('../util/db');
const getDomain = require('../util/getDomain');
const randomChar = require('../util/randomChar');

const statusPageCollection = 'statuspages';
const domainVerificationTokenCollection = 'domainverificationtokens';

async function run() {
    const statusPages = await find(statusPageCollection, {
        domain: { $type: 'string' },
    });

    for (let i = 0; i < statusPages.length; i++) {
        let statusPage = statusPages[i];
        const token = `fyipe=${randomChar()}`;
        const now = new Date().toISOString();

        const { ops = [{}] } = await save(domainVerificationTokenCollection, [
            {
                domain: getDomain(statusPage.domain),
                verified: false,
                deleted: false,
                verificationToken: token,
                createdAt: now,
                verifiedAt: null,
                deletedAt: null,
            },
        ]);
        let domains = [
            {
                domain: statusPage.domain,
                domainVerificationToken: ops[0]._id,
            },
        ];
        await update(
            statusPageCollection,
            { _id: statusPage._id },
            { domains }
        );
        await removeField(
            statusPageCollection,
            { _id: statusPage._id },
            { domain: '' }
        );
    }

    return `Script ran for ${statusPages.length} status pages.`;
}

module.exports = run;
