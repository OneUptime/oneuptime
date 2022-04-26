import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    user: {
        type: string,
        ref: 'User',
    },
    createdAt: {
        type: Date,
        default: Date.now(),
    },
    ipLocation: {
        type: Object,
    },
    device: {
        type: Object,
    },
    status: string,
}








