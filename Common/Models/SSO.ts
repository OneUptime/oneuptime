import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    'saml-enabled': {
        type: Boolean,
        required: true,
    },
    domain: {
        type: string,
        required: true,
    },
    entityId: {
        type: string,
        required: true,
    },
    remoteLoginUrl: {
        type: string,
        required: true,
    },
    certificateFingerprint: string,
    remoteLogoutUrl: {
        type: string,
        required: true,
    },
    ipRanges: string,
    ,
    deleted: boolean,

    deletedByUser: {
        type: string,
        ref: 'User',
        index: true,
    },
    project: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        index: true,
    },
}









