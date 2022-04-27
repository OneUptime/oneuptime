import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: Project,
    callRoutingId: { type: string, ref: 'CallRouting', index: true },
    



    deletedByUser: User,
    callSid: string,
    price: string,
    calledFrom: string,
    calledTo: string,
    duration: string,
    dialTo: [
        {
            callSid: string,
            user: User, // User that call was forwarded to
            scheduleId: { type: string, ref: 'Schedule', index: true }, // ScheduleId || ''
            phoneNumber: string, // Phone number that call was forwarded to
            status: string, // Completed/in progress/...
        },
    ],
}








