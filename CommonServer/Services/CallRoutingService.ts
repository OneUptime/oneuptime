import PaymentService from './PaymentService';
import TwilioService from './TwilioService';
import ScheduleService from './ScheduleService';
import AlertService from './AlertService';
import EscalationService from './EscalationService';
import UserService from './UserService';
import twilio from 'twilio';
import { IS_SAAS_SERVICE } from '../config/server';
import ProjectService from './ProjectService';
import ObjectID from 'Common/Types/ObjectID';
import FileService from './FileService';
import Query from '../Types/DB/Query';
import Model, {
    requiredFields,
    uniqueFields,
    slugifyField,
    encryptedFields,
} from '../Models/CallRouting';
import DatabaseService from './DatabaseService';
import CallRoutingLogService from './CallRoutingLogService';
import BadDataException from 'Common/Types/Exception/BadDataException';
class Service extends DatabaseService<typeof Model> {
    public constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
            friendlyName: 'Call Routing',
            publicListProps: {
                populate: [],
                select: [],
            },
            adminListProps: {
                populate: [],
                select: [],
            },
            ownerListProps: {
                populate: [],
                select: [],
            },
            memberListProps: {
                populate: [],
                select: [],
            },
            viewerListProps: {
                populate: [],
                select: [],
            },
            publicItemProps: {
                populate: [],
                select: [],
            },
            adminItemProps: {
                populate: [],
                select: [],
            },
            memberItemProps: {
                populate: [],
                select: [],
            },
            viewerItemProps: {
                populate: [],
                select: [],
            },
            ownerItemProps: {
                populate: [],
                select: [],
            },
            isResourceByProject: true,
            slugifyField: slugifyField,
            encryptedFields: encryptedFields,
        });
    }

    public async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const numbers: $TSFixMe = await Model.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        const stripeSubscriptionId: $TSFixMe = numbers.stripeSubscriptionId;

        await Promise.all([
            TwilioService.releasePhoneNumber(numbers.projectId, numbers.sid),
            PaymentService.removeSubscription(stripeSubscriptionId),
        ]);

        return numbers;
    }

    public async reserveNumber(data: $TSFixMe, projectId: ObjectID): void {
        let confirmBuy: $TSFixMe = null;
        const hasCustomTwilioSettings: $TSFixMe =
            await TwilioService.hasCustomSettings(projectId);
        if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
            const project: $TSFixMe = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'users',
            });
            let owner: $TSFixMe = project.users.filter((user: $TSFixMe) => {
                return user.role === 'Owner';
            });
            owner = owner && owner.length ? owner[0] : owner;
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: owner.userId },
                select: 'stripeCustomerId',
            });
            const stripeCustomerId: $TSFixMe = user.stripeCustomerId;
            const stripeSubscription: $TSFixMe =
                await PaymentService.createSubscription(
                    stripeCustomerId,
                    data.price
                );
            if (
                stripeSubscription &&
                stripeSubscription.id &&
                stripeSubscription.id.length
            ) {
                data.stripeSubscriptionId = stripeSubscription.id;
            } else {
                throw new BadDataException('Error Creating Subscription.');
            }
            if (
                data &&
                data.stripeSubscriptionId &&
                data.stripeSubscriptionId.length
            ) {
                confirmBuy = await TwilioService.buyPhoneNumber(
                    data.projectId,
                    data.phoneNumber
                );
            }
        } else {
            confirmBuy = await TwilioService.buyPhoneNumber(
                data.projectId,
                data.phoneNumber
            );
        }
        data.sid = confirmBuy && confirmBuy.sid ? confirmBuy.sid : null;
        const CallRouting: $TSFixMe = await this.create(data);
        return CallRouting;
    }

    public async findTeamMember(type: $TSFixMe, id: $TSFixMe): void {
        let user: $TSFixMe;
        const selectEscalation: string = 'teams createdAt deleted deletedAt';

        const populateEscalation: $TSFixMe = [
            {
                path: 'teams.teamMembers.user',
                select: 'name email',
            },
            {
                path: 'teams.teamMembers.groups',
                select: 'teams name',
            },
        ];
        if (type && type === 'TeamMember') {
            user = await UserService.findOneBy({
                query: { _id: id },
                select: 'alertPhoneNumber _id',
            });
            if (user && user.alertPhoneNumber && user.alertPhoneNumber.length) {
                return {
                    forwardingNumber: user.alertPhoneNumber,
                    error: null,
                    userId: user && user._id ? user._id : null,
                };
            } else {
                return {
                    forwardingNumber: null,
                    error: 'Active team have not added their phone number yet',
                    userId: user && user._id ? user._id : null,
                };
            }
        } else if (type && type === 'Schedule') {
            const schedules: $TSFixMe = await ScheduleService.findOneBy({
                query: { _id: id },
                select: '_id escalationIds',
            });
            const escalationId: $TSFixMe =
                schedules &&
                schedules.escalationIds &&
                schedules.escalationIds.length
                    ? schedules.escalationIds[0]
                    : null;
            const escalation: $TSFixMe = escalationId
                ? await EscalationService.findOneBy({
                      query: { _id: escalationId },
                      select: selectEscalation,
                      populate: populateEscalation,
                  })
                : null;
            const activeTeam: $TSFixMe =
                escalation && escalation.activeTeam
                    ? escalation.activeTeam
                    : null;
            if (
                activeTeam &&
                activeTeam.teamMembers &&
                activeTeam.teamMembers.length
            ) {
                let dutyCheck: $TSFixMe = 0;
                for (const teamMember of activeTeam.teamMembers) {
                    const [isOnDuty, user]: $TSFixMe = await Promise.all([
                        AlertService.checkIsOnDuty(
                            teamMember.startTime,
                            teamMember.endTime
                        ),
                        UserService.findOneBy({
                            query: { _id: teamMember.userId },
                            select: 'alertPhoneNumber _id',
                        }),
                    ]);
                    if (!user || !isOnDuty) {
                        continue;
                    }
                    if (
                        user &&
                        user.alertPhoneNumber &&
                        user.alertPhoneNumber.length
                    ) {
                        dutyCheck++;
                        return {
                            forwardingNumber: user.alertPhoneNumber,
                            error: null,
                            userId: user && user._id ? user._id : null,
                        };
                    }
                }
                if (dutyCheck <= 0) {
                    const user: $TSFixMe = await UserService.findOneBy({
                        query: { _id: activeTeam.teamMembers[0].userId },
                        select: '_id alertPhoneNumber',
                    });
                    if (
                        user &&
                        user.alertPhoneNumber &&
                        user.alertPhoneNumber.length
                    ) {
                        return {
                            forwardingNumber: user.alertPhoneNumber,
                            error: null,
                            userId: user && user._id ? user._id : null,
                        };
                    }
                } else {
                    return {
                        forwardingNumber: null,
                        error: 'Active team have not added their phone number yet',

                        userId: user && user._id ? user._id : null,
                    };
                }
            } else {
                return {
                    forwardingNumber: null,
                    error: 'Active team unavailable',

                    userId: user && user._id ? user._id : null,
                };
            }
        }
    }

    public async chargeRoutedCall(projectId: ObjectID, body: $TSFixMe): void {
        const callSid: $TSFixMe = body.CallSid;
        const callStatus: $TSFixMe = body.CallStatus || null;
        const callDetails: $TSFixMe = await TwilioService.getCallDetails(
            projectId,
            callSid
        );
        if (callDetails && callDetails.price) {
            const duration: $TSFixMe = callDetails.duration;
            let price: $TSFixMe = callDetails.price;
            if (price && price.includes('-')) {
                price = price.replace('-', '');
            }
            price = price * 10;
            const hasCustomTwilioSettings: $TSFixMe =
                await TwilioService.hasCustomSettings(projectId);
            if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                const project: $TSFixMe = await ProjectService.findOneBy({
                    query: { _id: projectId },
                    select: 'users',
                });
                let owner: $TSFixMe = project.users.filter((user: $TSFixMe) => {
                    return user.role === 'Owner';
                });
                owner = owner && owner.length ? owner[0] : owner;
                await PaymentService.chargeAlert(
                    owner.userId,
                    projectId,
                    price
                );
            }
            const callRoutingLog: $TSFixMe =
                await CallRoutingLogService.findOneBy({
                    query: { callSid },
                    select: 'callSid dialTo _id',
                });
            if (callRoutingLog && callRoutingLog.callSid) {
                let dialTo: $TSFixMe =
                    callRoutingLog.dialTo && callRoutingLog.dialTo.length
                        ? callRoutingLog.dialTo
                        : [];
                dialTo = dialTo.map((dt: $TSFixMe) => {
                    if (dt.callSid !== callSid) {
                        dt.status =
                            callStatus && callStatus.length
                                ? callStatus
                                : dt.status;
                    }
                    return dt;
                });
                await CallRoutingLogService.updateOneBy(
                    { _id: callRoutingLog._id },
                    { price, duration, dialTo }
                );
            } else {
                await CallRoutingLogService.updateOneBy(
                    { callSid: callSid },
                    { price, duration }
                );
            }
        }
        return 'Customer has been successfully charged for the call.';
    }

    public async getCallResponse(
        data: $TSFixMe,
        to: $TSFixMe,
        body: $TSFixMe,
        backup: $TSFixMe
    ): void {
        const fromNumber: $TSFixMe = body.From;
        const callSid: $TSFixMe = body.CallSid;
        const dialCallSid: $TSFixMe = body.DialCallSid || null;
        const callStatus: $TSFixMe = body.CallStatus || null;
        const dialCallStatus: $TSFixMe = body.DialCallStatus || null;

        const project: $TSFixMe = await ProjectService.findOneBy({
            query: { _id: data.projectId },
            select: 'balance alertOptions',
        });
        const balance: $TSFixMe = project.balance;
        const customThresholdAmount: $TSFixMe = project.alertOptions
            ? project.alertOptions.minimumBalance
            : null;
        const isBalanceMoreThanMinimum: $TSFixMe = balance > 10;
        const isBalanceMoreThanCustomThresholdAmount: $TSFixMe =
            customThresholdAmount ? balance > customThresholdAmount : null;
        const hasEnoughBalance: $TSFixMe =
            isBalanceMoreThanCustomThresholdAmount
                ? isBalanceMoreThanCustomThresholdAmount &&
                  isBalanceMoreThanMinimum
                : isBalanceMoreThanMinimum;

        if (!hasEnoughBalance) {
            response.reject();

            return response;
        }

        const routingSchema: $TSFixMe =
            data && data.routingSchema && data.routingSchema.type
                ? data.routingSchema
                : {};
        let memberId: $TSFixMe = null;
        const response: $TSFixMe = new twilio.twiml.VoiceResponse();
        let forwardingNumber: $TSFixMe,
            error: $TSFixMe,
            userId: $TSFixMe,
            scheduleId: $TSFixMe;

        const {
            type,
            id,
            phonenumber,
            backup_type,
            backup_id,
            backup_phonenumber,
            introAudio,
            introtext,
            backup_introAudio,
            backup_introtext,
            callDropText,
            showAdvance,
        } = routingSchema;

        if (!backup && showAdvance && introtext && introtext.length) {
            response.say(introtext);
        }
        if (
            backup &&
            showAdvance &&
            backup_introtext &&
            backup_introtext.length
        ) {
            response.say(backup_introtext);
        }
        if (!backup && showAdvance && introAudio && introAudio.length) {
            response.play(`${global.apiHost}/file/${introAudio}`);
        }
        if (
            backup &&
            showAdvance &&
            backup_introAudio &&
            backup_introAudio.length
        ) {
            response.play(`${global.apiHost}/file/${backup_introAudio}`);
        }

        if (type && !backup) {
            if (id && id.length && type !== 'PhoneNumber') {
                const result: $TSFixMe = await this.findTeamMember(type, id);

                forwardingNumber = result.forwardingNumber;

                error = result.error;

                userId = result.userId;
                scheduleId = type === 'Schedule' ? id : null;
                if (userId) {
                    memberId = userId;
                }
            } else if (
                type === 'PhoneNumber' &&
                phonenumber &&
                phonenumber.length
            ) {
                forwardingNumber = phonenumber;
                error = null;
                userId = null;
            }
        } else if (backup_type && backup) {
            if (
                backup_id &&
                backup_id.length &&
                backup_type !== 'PhoneNumber'
            ) {
                const result: $TSFixMe = await this.findTeamMember(
                    backup_type,
                    backup_id
                );

                forwardingNumber = result.forwardingNumber;

                error = result.error;

                userId = result.userId;
                scheduleId = backup_type === 'Schedule' ? backup_id : null;
                if (userId) {
                    memberId = userId;
                }
            } else if (
                backup_type === 'PhoneNumber' &&
                backup_phonenumber &&
                backup_phonenumber.length
            ) {
                forwardingNumber = backup_phonenumber;
                error = null;
                userId = null;
            }
        } else {
            if (showAdvance && callDropText && callDropText.length) {
                response.say(callDropText);
            } else {
                response.say('Sorry could not find anyone on duty');
            }
        }
        if (
            !forwardingNumber ||
            (forwardingNumber && !forwardingNumber.length)
        ) {
            if (showAdvance && callDropText && callDropText.length) {
                response.say(callDropText);
            } else {
                response.say('Sorry could not find anyone on duty');
            }
        }
        if (
            forwardingNumber &&
            (!error || (error && error.length <= 0)) &&
            !backup
        ) {
            response.dial(
                {
                    action: `${global.apiHost}/callRouting/routeBackupCall`,
                },
                forwardingNumber
            );
        } else if (
            forwardingNumber &&
            (!error || (error && error.length <= 0)) &&
            backup
        ) {
            response.dial(forwardingNumber);
        } else if (!forwardingNumber && error && error.length) {
            response.say(error);
        }
        const callRoutingLog: $TSFixMe = await CallRoutingLogService.findOneBy({
            query: { callSid },
            select: '_id dialTo callSid',
        });
        if (callRoutingLog && callRoutingLog.callSid) {
            let dialTo: $TSFixMe =
                callRoutingLog.dialTo && callRoutingLog.dialTo.length
                    ? callRoutingLog.dialTo
                    : [];
            dialTo = dialTo.map((dt: $TSFixMe) => {
                dt.callSid =
                    dialCallSid && dialCallSid.length ? dialCallSid : callSid;
                dt.status =
                    dialCallStatus && dialCallStatus.length
                        ? dialCallStatus
                        : callStatus;
                return dt;
            });
            dialTo.push({
                callSid: callSid,
                userId: memberId,
                scheduleId: scheduleId,
                phoneNumber: phonenumber,
                status: callStatus,
            });
            await CallRoutingLogService.updateOneBy(
                { _id: callRoutingLog._id },
                { dialTo }
            );
        } else if (data && data._id) {
            await CallRoutingLogService.create({
                callRoutingId: data && data._id ? data._id : null,
                calledFrom: fromNumber,
                calledTo: to,
                dialTo: [
                    {
                        callSid: callSid,
                        userId: memberId,
                        scheduleId: scheduleId,
                        phoneNumber: phonenumber,
                        status: callStatus ? callStatus : null,
                    },
                ],
                callSid: callSid,
            });
        }
        response.say('Goodbye');
        return response;
    }

    public async updateRoutingSchema(data: $TSFixMe): void {
        const currentCallRouting: $TSFixMe = await this.findOneBy({
            query: { _id: data.callRoutingId },
            select: 'routingSchema',
        });
        const routingSchema: $TSFixMe =
            currentCallRouting && currentCallRouting.routingSchema
                ? currentCallRouting.routingSchema
                : {};
        const showAdvance: $TSFixMe =
            Object.keys(data).indexOf('showAdvance') > -1
                ? data.showAdvance
                : 'null';

        if (showAdvance !== 'null') {
            routingSchema.showAdvance = data.showAdvance;
            routingSchema.type = data.type;
            if (data.type && data.type === 'TeamMember') {
                routingSchema.id = data.teamMemberId;
            } else if (data.type && data.type === 'Schedule') {
                routingSchema.id = data.scheduleId;
            } else if (data.type && data.type === 'PhoneNumber') {
                routingSchema.phoneNumber = data.phoneNumber;
            }
            if (showAdvance) {
                routingSchema.backup_type = data.backup_type;
                routingSchema.introtext = data.introtext;
                routingSchema.backup_introtext = data.backup_introtext;
                routingSchema.callDropText = data.callDropText;
                if (data.backup_type && data.backup_type === 'TeamMember') {
                    routingSchema.backup_id = data.backup_teamMemberId;
                } else if (
                    data.backup_type &&
                    data.backup_type === 'Schedule'
                ) {
                    routingSchema.backup_id = data.backup_scheduleId;
                } else if (
                    data.backup_type &&
                    data.backup_type === 'PhoneNumber'
                ) {
                    routingSchema.backup_phoneNumber = data.backup_phoneNumber;
                }
            }
        }
        const CallRouting: $TSFixMe = await this.updateOneBy(
            { _id: data.callRoutingId },
            { routingSchema }
        );

        return CallRouting;
    }

    public async updateRoutingSchemaAudio(data: $TSFixMe): void {
        const currentCallRouting: $TSFixMe = await this.findOneBy({
            query: { _id: data.callRoutingId },
            select: 'routingSchema',
        });
        const routingSchema: $TSFixMe =
            currentCallRouting && currentCallRouting.routingSchema
                ? currentCallRouting.routingSchema
                : {};
        const currentIntroAudio: $TSFixMe =
            routingSchema &&
            routingSchema.introAudio &&
            routingSchema.introAudio.length
                ? routingSchema.introAudio
                : null;
        const currentBackupIntroAudio: $TSFixMe =
            routingSchema &&
            routingSchema.backup_introAudio &&
            routingSchema.backup_introAudio.length
                ? routingSchema.backup_introAudio
                : null;

        if (data.audioFieldName && data.audioFieldName === 'introAudio') {
            if (currentIntroAudio) {
                await FileService.deleteOneBy({
                    filename: currentIntroAudio,
                });
            }
            if (data.file && data.file.length) {
                routingSchema.introAudio = data.file;
            }
            if (data.fileName && data.fileName.length) {
                routingSchema.introAudioName = data.fileName;
            }
        } else if (
            data.audioFieldName &&
            data.audioFieldName === 'backup_introAudio'
        ) {
            if (currentBackupIntroAudio) {
                await FileService.deleteOneBy({
                    filename: currentBackupIntroAudio,
                });
            }
            if (data.file && data.file.length) {
                routingSchema.backup_introAudio = data.file;
            }
            if (data.fileName && data.fileName.length) {
                routingSchema.backup_introAudioName = data.fileName;
            }
        }
        const CallRouting: $TSFixMe = await this.updateOneBy(
            { _id: data.callRoutingId },
            { routingSchema }
        );

        return CallRouting;
    }

    public async getCallRoutingLogs(projectId: ObjectID): void {
        let logs: $TSFixMe = [];
        const callRouting: $TSFixMe = await this.findBy({
            query: { projectId },
            select: '_id',
        });
        if (callRouting && callRouting.length) {
            const select: $TSFixMe =
                'callRoutingId callSid price calledFrom calledTo duration dialTo';
            for (let i: $TSFixMe = 0; i < callRouting.length; i++) {
                const callRoutingId: $TSFixMe = callRouting[i]._id;
                const callLogs: $TSFixMe = await CallRoutingLogService.findBy({
                    query: { callRoutingId },
                    select,
                });
                if (callLogs && callLogs.length) {
                    logs = logs.concat(callLogs);
                }
            }
        }
        return logs;
    }
}

export default Service;
