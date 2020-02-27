module.exports = {
    signup: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            id: '5d301b203c5a922d289d1f2e',
            name: 'David Disu',
            email: 'noreply@fyipe.com',
            cardRegistered: true,
            tokens: {
                jwtAccessToken:
                    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjVkMzAxYjIwM2M1YTkyMmQyODlkMWYyZSIsIm5hbWUiOiJPbGFsZWthbiBBeW9kZWxlIiwiZW1haWwiOiJub3JlcGx5QGZ5aXBlLmNvbSIsImlhdCI6MTU2MzQzMzgwMiwiZXhwIjoxNTcyMDczODAyfQ.PPH507osH3VXDNWscdrshBqRk0x8sNsIvxNNrVGx0gI',
                jwtRefreshToken:
                    'D5Ll7uoHOgNNWY7crH1VmLgPmh2RLlCoQHiXdSfP4ugiKR5tolQGdsMTaMXaH7hbUedNavVsTc9N6pfxAENmPxTQshHo94OXAjUiicTo48aHAZWygHJJd8m2O4yHOV7sAkvRUksu2joqeE45JQo3sIp8Z2kv81E53lzo4WPG8VGSplTWmdh9a4XSTUsfbjv3xEZvymeKXtAsH8oERWUY3JkyCfOC308kaww1P2I9sYbmXhC0qS2rgdTBfDlAkqcZ',
            },
        }),
    },
    login: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            id: '5d301b203c5a922d289d1f2e',
            name: 'David Disu',
            email: 'noreply@fyipe.com',
            redirect: null,
            cardRegistered: true,
            tokens: {
                jwtAccessToken:
                    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjVkMzAxYjIwM2M1YTkyMmQyODlkMWYyZSIsIm5hbWUiOiJPbGFsZWthbiBBeW9kZWxlIiwiZW1haWwiOiJub3JlcGx5QGZ5aXBlLmNvbSIsImlhdCI6MTU2MzQzMzgwMiwiZXhwIjoxNTcyMDczODAyfQ.PPH507osH3VXDNWscdrshBqRk0x8sNsIvxNNrVGx0gI',
                jwtRefreshToken:
                    'D5Ll7uoHOgNNWY7crH1VmLgPmh2RLlCoQHiXdSfP4ugiKR5tolQGdsMTaMXaH7hbUedNavVsTc9N6pfxAENmPxTQshHo94OXAjUiicTo48aHAZWygHJJd8m2O4yHOV7sAkvRUksu2joqeE45JQo3sIp8Z2kv81E53lzo4WPG8VGSplTWmdh9a4XSTUsfbjv3xEZvymeKXtAsH8oERWUY3JkyCfOC308kaww1P2I9sYbmXhC0qS2rgdTBfDlAkqcZ',
            },
        }),
    },
    createProject: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            alertOptions: {
                billingUS: true,
                billingNonUSCountries: false,
                billingRiskCountries: false,
            },
            seats: '1',
            deleted: false,
            alertEnable: false,
            _id: '5d306867d4dea33e5cf82359',
            users: [
                {
                    _id: '5d306867d4dea33e5cf8235a',
                    userId: '5d301b203c5a922d289d1f2e',
                    role: 'Owner',
                },
            ],
            createdAt: '2019-07-18T12:39:03.647Z',
            name: 'NewProject',
            slug: 'New-Project-70424',
            apiKey: '066cae00-a959-11e9-8180-5fd7b48fdcaa',
            stripePlanId: 'plan_EgTJMZULfh6THW',
            stripeSubscriptionId: 'sub_FSTqtuxbgu79Xy',
            stripeExtraUserSubscriptionId: 'sub_FSTqosKiXgQzgW',
            stripeMeteredSubscriptionId: 'sub_FSTqO22Ygw94hp',
            parentProjectId: null,
            __v: 0,
        }),
    },
    isInvited: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(false),
    },
    renameProject: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            alertOptions: {
                billingUS: true,
                billingNonUSCountries: false,
                billingRiskCountries: false,
            },
            seats: '1',
            deleted: false,
            alertEnable: false,
            _id: '5d310b13afc464388ca792d1',
            users: [
                {
                    _id: '5d306867d4dea33e5cf8235a',
                    userId: '5d301b203c5a922d289d1f2e',
                    role: 'Owner',
                },
            ],
            createdAt: '2019-07-18T12:39:03.647Z',
            name: 'RenamedProject',
            slug: 'Test-Project-70424',
            apiKey: '066cae00-a959-11e9-8180-5fd7b48fdcaa',
            stripePlanId: 'plan_EgTJMZULfh6THW',
            stripeSubscriptionId: 'sub_FSTqtuxbgu79Xy',
            stripeExtraUserSubscriptionId: 'sub_FSTqosKiXgQzgW',
            stripeMeteredSubscriptionId: 'sub_FSTqO22Ygw94hp',
            parentProjectId: null,
            __v: 0,
        }),
    },
    getProjects: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            data: [
                {
                    alertOptions: {
                        billingUS: true,
                        billingNonUSCountries: false,
                        billingRiskCountries: false,
                    },
                    seats: '1',
                    deleted: false,
                    alertEnable: false,
                    _id: '5d310b13afc464388ca792d1',
                    users: [
                        {
                            _id: '5d306867d4dea33e5cf8235a',
                            userId: '5d301b203c5a922d289d1f2e',
                            role: 'Owner',
                        },
                    ],
                    createdAt: '2019-07-19T00:13:07.595Z',
                    name: 'TestProject',
                    slug: 'Test-Project-62843',
                    apiKey: 'fc27a010-a9b9-11e9-9852-e3432407585f',
                    stripePlanId: 'plan_EgTJMZULfh6THW',
                    stripeSubscriptionId: 'sub_FSf2kwgaNoLcJZ',
                    stripeExtraUserSubscriptionId: 'sub_FSf2mKnBU3waFa',
                    stripeMeteredSubscriptionId: 'sub_FSf2RVscGk0euo',
                    parentProjectId: null,
                    __v: 0,
                },
            ],
            count: 1,
        }),
    },
    createSubProject: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            alertOptions: {
                billingUS: true,
                billingNonUSCountries: false,
                billingRiskCountries: false,
            },
            seats: '1',
            deleted: false,
            alertEnable: false,
            _id: '5d31113e39848820e8f14afc',
            users: [
                {
                    _id: '5d306867d4dea33e5cf8235a',
                    userId: '5d301b203c5a922d289d1f2e',
                    role: 'Owner',
                },
            ],
            createdAt: '2019-07-19T00:39:26.447Z',
            name: 'NewSubProject',
            slug: 'New-SubProject-54588',
            apiKey: 'a93a15a0-a9bd-11e9-a662-914f8478a638',
            stripePlanId: null,
            stripeSubscriptionId: null,
            stripeExtraUserSubscriptionId: null,
            stripeMeteredSubscriptionId: null,
            parentProjectId: {
                _id: '5d310b13afc464388ca792d1',
                name: 'TestProject',
            },
            __v: 0,
        }),
    },
    teamLoading: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
            {
                teamMembers: [
                    {
                        userId: '5d301b203c5a922d289d1f2e',
                        email: 'noreply@fyipe.com',
                        name: 'David Disu',
                        role: 'Owner',
                        lastActive: '2019-07-19T01:02:06.216Z',
                    },
                ],
                count: 1,
                _id: '5d310b13afc464388ca792d1',
            },
            {
                teamMembers: [
                    {
                        userId: '5d301b203c5a922d289d1f2e',
                        email: 'noreply@fyipe.com',
                        name: 'David Disu',
                        role: 'Owner',
                        lastActive: '2019-07-19T01:02:06.216Z',
                    },
                ],
                count: 1,
                _id: '5d31113e39848820e8f14afc',
            },
        ]),
    },
    getSubProjects: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            data: [
                {
                    alertOptions: {
                        billingUS: true,
                        billingNonUSCountries: false,
                        billingRiskCountries: false,
                    },
                    seats: '1',
                    deleted: false,
                    alertEnable: false,
                    _id: '5d31741913376c409469c683',
                    users: [
                        {
                            _id: '5d306867d4dea33e5cf8235a',
                            userId: '5d301b203c5a922d289d1f2e',
                            role: 'Owner',
                        },
                    ],
                    createdAt: '2019-07-19T07:41:13.426Z',
                    name: 'NewSubProject',
                    slug: 'New-SubProject-68145',
                    apiKey: '955c0490-a9f8-11e9-9bca-65d4d4eb88c9',
                    stripePlanId: null,
                    stripeSubscriptionId: null,
                    stripeExtraUserSubscriptionId: null,
                    stripeMeteredSubscriptionId: null,
                    parentProjectId: {
                        _id: '5d310b13afc464388ca792d1',
                        name: 'TestProject',
                    },
                    __v: 0,
                },
            ],
            count: 1,
        }),
    },
    teamCreate: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            data: [
                {
                    alertOptions: {
                        billingUS: true,
                        billingNonUSCountries: false,
                        billingRiskCountries: false,
                    },
                    seats: '1',
                    deleted: false,
                    alertEnable: false,
                    _id: '5d31741913376c409469c683',
                    users: [
                        {
                            _id: '5d306867d4dea33e5cf8235a',
                            userId: '5d301b203c5a922d289d1f2e',
                            role: 'Owner',
                        },
                    ],
                    createdAt: '2019-07-19T07:41:13.426Z',
                    name: 'NewSubProject',
                    slug: 'New-SubProject-68145',
                    apiKey: '955c0490-a9f8-11e9-9bca-65d4d4eb88c9',
                    stripePlanId: null,
                    stripeSubscriptionId: null,
                    stripeExtraUserSubscriptionId: null,
                    stripeMeteredSubscriptionId: null,
                    parentProjectId: {
                        _id: '5d310b13afc464388ca792d1',
                        name: 'TestProject',
                    },
                    __v: 0,
                },
            ],
            count: 1,
        }),
    },
};
