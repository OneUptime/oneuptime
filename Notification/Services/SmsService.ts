import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import { SMSDefaultCostInCents, TwilioAccountSid, TwilioAuthToken, TwilioPhoneNumber } from "../Config";
import Twilio from 'twilio';
import BadDataException from "Common/Types/Exception/BadDataException";
import SmsLog from "Model/Models/SmsLog";
import SmsStatus from "Common/Types/SmsStatus";
import { IsBillingEnabled } from "CommonServer/Config";
import SmsLogService from "CommonServer/Services/SmsLogService"
import ProjectService from "CommonServer/Services/ProjectService";
import Project from "Model/Models/Project";

export default class SmsService {
    public static async sendSms(to: Phone, message: string, options: {
        projectId?: ObjectID | undefined // project id for sms log
        from: Phone, // from phone number
    }): Promise<void> {

        if (!TwilioAccountSid) {
            throw new BadDataException('TwilioAccountSid is not configured');
        }

        if (!TwilioAuthToken) {
            throw new BadDataException('TwilioAuthToken is not configured');
        }


        if (!TwilioPhoneNumber) {
            throw new BadDataException('TwilioPhoneNumber is not configured');
        }

        const client: Twilio.Twilio = Twilio(TwilioAccountSid, TwilioAuthToken);

        const smsLog: SmsLog = new SmsLog();
        smsLog.toNumber = to;
        smsLog.fromNumber = options.from;
        smsLog.smsText = message;

        if (options.projectId) {
            smsLog.projectId = options.projectId;
        }

        let project: Project | null =  null ;

        try {

            // make sure project has enough balance. 
            
            if (options.projectId && IsBillingEnabled) {
                project = await ProjectService.findOneById({
                    id: options.projectId,
                    select: {
                        smsOrCallCurrentBalanceInUSDCents: true,
                        enableAutoRechargeSmsOrCallBalance: true
                    },
                    props: {
                        isRoot: true
                    }
                });

                if (!project) {
                    throw new BadDataException(`Project ${options.projectId.toString()} not found.`);
                }

                if (!project.smsOrCallCurrentBalanceInUSDCents) {
                    throw new BadDataException(`Project ${options.projectId.toString()} does not have enough SMS balance.`);
                }

                if (project.smsOrCallCurrentBalanceInUSDCents < SMSDefaultCostInCents) {
                    throw new BadDataException(`Project does not have enough balance to send SMS. Current balance is ${project.smsOrCallCurrentBalanceInUSDCents} cents. Required balance is ${SMSDefaultCostInCents} cents to send this SMS.`);
                }

            }

            await client.messages
                .create({
                    body: message,
                    to: to.toString(),
                    from: options && options.from ? options.from.toString() : TwilioPhoneNumber.toString(), // From a valid Twilio number
                });


            smsLog.status = SmsStatus.Success;
            smsLog.errorMessage = "";

            if (IsBillingEnabled && project) {
                smsLog.smsCostInUSDCents = SMSDefaultCostInCents;

                project.smsOrCallCurrentBalanceInUSDCents = Math.floor(project.smsOrCallCurrentBalanceInUSDCents! - SMSDefaultCostInCents);

                await ProjectService.updateOneById({
                    data: {
                        smsOrCallCurrentBalanceInUSDCents: project.smsOrCallCurrentBalanceInUSDCents
                    },
                    id: project.id!,
                    props: {
                        isRoot: true
                    }
                });
            }

        } catch (e: any) {
            smsLog.status = SmsStatus.Error;
            smsLog.errorMessage = e && e.message ? e.message.toString() : e.toString();
        }

        if (options.projectId) {
            await SmsLogService.create({
                data: smsLog, 
                props: {
                    isRoot: true
                }
            });
        }
    }
}