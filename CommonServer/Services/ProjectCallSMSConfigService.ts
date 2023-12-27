import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/ProjectCallSMSConfig';
import DatabaseService from './DatabaseService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import TwilioConfig from 'Common/Types/CallAndSMS/TwilioConfig';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public toTwilioConfig(
        projectCallSmsConfig: Model | undefined
    ): TwilioConfig | undefined {
        if (!projectCallSmsConfig) {
            return undefined;
        }

        if (!projectCallSmsConfig.id) {
            throw new BadDataException(
                'Project Call and SMS Config id is not set'
            );
        }

        if (!projectCallSmsConfig.twilioAccountSID) {
            throw new BadDataException(
                'Project Call and SMS Config twilio account SID is not set'
            );
        }

        if (!projectCallSmsConfig.twilioPhoneNumber) {
            throw new BadDataException(
                'Project Call and SMS Config twilio phone number is not set'
            );
        }

        if (!projectCallSmsConfig.twilioAuthToken) {
            throw new BadDataException(
                'Project Call and SMS Config twilio auth token is not set'
            );
        }

        return {
            accountSid: projectCallSmsConfig.twilioAccountSID,
            phoneNumber: projectCallSmsConfig.twilioPhoneNumber,
            authToken: projectCallSmsConfig.twilioAuthToken,
        };
    }
}
export default new Service();
