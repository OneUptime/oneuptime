import { find, save, update, removeField } from '../util/db';
import getDomain from '../util/getDomain';
import randomChar from '../util/randomChar';

const statusPageCollection: string = 'statuspages';
const domainVerificationTokenCollection: string = 'domainverificationtokens';

async function run(): void {
    const statusPages: $TSFixMe = await find(statusPageCollection, {
        domain: { $type: 'string' },
    });

    for (let i = 0; i < statusPages.length; i++) {
        const statusPage: $TSFixMe = statusPages[i];
        const token: string = `oneuptime=${randomChar()}`;
        const now: $TSFixMe = new Date().toISOString();

        const { ops = [{}] }: $TSFixMe = await save(
            domainVerificationTokenCollection,
            [
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
            ]
        );
        const domains: $TSFixMe = [
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
