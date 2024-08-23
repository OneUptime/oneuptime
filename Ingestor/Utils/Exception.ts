import Exception from 'Common/Models/AnalyticsModels/Exception';
import Crypto from 'Common/Utils/Crypto';

export default class ExceptionUtil { 
    public static getFingerprint(exception: Exception): string {
        const message: string = exception.message || "";
        const stackTrace: string = exception.stackTrace || "";
        const type: string = exception.exceptionType || "";
        const projectId: string = exception.projectId?.toString() || "";
        const serviceId: string = exception.serviceId?.toString() || "";

        const hash: string = Crypto.getSha256Hash(projectId + serviceId + message + stackTrace + type);
        
        return hash;
    }
}