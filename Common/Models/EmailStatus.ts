import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    fromEmail: string,
    fromName: string,

    project: Project,

    toEmail: string,
    subject: string,
    body: string,
    templateType: string,
    status: string,
    errorDescription: string,
    smtpHost: string,

    createdAt: { type: Date, default: Date.now }


    deletedByUser: User,
}








