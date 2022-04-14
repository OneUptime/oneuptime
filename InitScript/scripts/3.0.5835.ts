import { find, update, save } from '../util/db';

import bcrypt from 'bcrypt';
const { IS_TESTING, IS_SAAS_SERVICE }: $TSFixMe = process.env;

const userCollection: string = 'users';
const projectCollection: string = 'projects';
const incidentPriorityCollection: string = 'incidentpriorities';
const email: string = 'masteradmin@hackerbay.io';
const plainPassword: string = '1234567890';
const saltRounds: $TSFixMe = 10;

async function run(): void {
    if (IS_TESTING === 'true' && IS_SAAS_SERVICE === 'true') {
        const password: $TSFixMe = await bcrypt.hash(plainPassword, saltRounds);
        let result = await find(userCollection, { email });
        if (result.length > 0) {
            const masterAdmin: $TSFixMe = result[0];
            const { _id }: $TSFixMe = masterAdmin;
            update(userCollection, { _id }, { password });
        } else {
            result = await save(userCollection, [
                {
                    email,
                    password,
                    name: 'administrator',
                    role: 'master-admin',
                    disabled: false,
                    isVerified: true,
                    twoFactorAuthEnabled: false,
                    isBlocked: false,
                    deleted: false,
                    companyName: 'hackerbay',
                    companyPhoneNumber: '+19173976235',
                },
            ]);
            const userId: $TSFixMe = result?.ops[0]?._id;
            const project: $TSFixMe = await save(projectCollection, [
                {
                    name: 'Test Project',
                    apiKey: 'd7309ae0-cddf-11eb-9f6e-b7f55589eea9',
                    slug: 'Test-project-77861402',
                    stripePlanId: null,
                    stripeSubscriptionId: null,
                    parentProjectId: null,
                    seats: '1',
                    isBlocked: false,
                    adminNotes: null,
                    deleted: false,
                    users: [
                        {
                            userId: String(userId),
                            role: 'Owner',
                        },
                    ],
                },
            ]);
            const projectId: $TSFixMe = project?.ops[0]?._id;

            await save(incidentPriorityCollection, [
                {
                    projectId: projectId,
                    name: 'High',
                    color: {
                        r: 255,
                        g: 0,
                        b: 0,
                        a: 1,
                    },
                },
                {
                    projectId: projectId,
                    name: 'Low',
                    color: {
                        r: 255,
                        g: 211,
                        b: 0,
                        a: 1,
                    },
                },
            ]);
        }
    }
}

export default run;
