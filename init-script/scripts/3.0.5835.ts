
import { find, update, save } from '../util/db';

import bcrypt from 'bcrypt';
const { IS_TESTING, IS_SAAS_SERVICE } = process.env;

const userCollection = 'users';
const projectCollection = 'projects';
const incidentPriorityCollection = 'incidentpriorities';
const email = 'masteradmin@hackerbay.io';
const plainPassword = '1234567890';
const saltRounds = 10;

async function run() {
    if (IS_TESTING === 'true' && IS_SAAS_SERVICE === 'true') {
        const password = await bcrypt.hash(plainPassword, saltRounds);
        let result = await find(userCollection, { email });
        if (result.length > 0) {
            const masterAdmin = result[0];
            const { _id } = masterAdmin;
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
            const userId = result?.ops[0]?._id;
            const project = await save(projectCollection, [
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
            const projectId = project?.ops[0]?._id;

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
