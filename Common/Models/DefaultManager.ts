import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        store: {
            type: Object,
            default: {
                module: 'oneuptime-le-store',
            },
        },
        challenges: {
            'http-01': {
                type: Object,
                default: {
                    module: 'oneuptime-acme-http-01',
                },
            },
        },
        renewOffset: { type: string, default: '-45d' },
        renewStagger: { type: string, default: '3d' },
        accountKeyType: string,
        serverKeyType: string,
        subscriberEmail: string,
        agreeToTerms: boolean,
        
        deletedAt: Date,
    },
    { timestamps: true }
);









