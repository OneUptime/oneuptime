// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, save, update, removeField } from '../util/db';
import getDomain from '../util/getDomain';
import randomChar from '../util/randomChar';

const statusPageCollection = 'statuspages';
const domainVerificationTokenCollection = 'domainverificationtokens';

async function run() {
    const statusPages = await find(statusPageCollection, {
        domain: { $type: 'string' },
    });

    for (let i = 0; i < statusPages.length; i++) {
        const statusPage = statusPages[i];
        const token = `oneuptime=${randomChar()}`;
        const now = new Date().toISOString();

        const { ops = [{}] } = await save(domainVerificationTokenCollection, [
            {
                domain: getDomain(statusPage.domain),
                verified: true,
                deleted: false,
                verificationToken: token,
                createdAt: now,
                verifiedAt: now,
                deletedAt: null,
                projectId: statusPage.projectId,
            },
        ]);
        const domains = [
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
            'domain'
        );
    }

    return `Script ran for ${statusPages.length} status pages.`;
}

export default run;
