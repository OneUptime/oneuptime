module.exports = {
    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;
            const callRouting = await CallRoutingModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId');
            return callRouting;
        } catch (error) {
            ErrorService.log('callRoutingService.findBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            const callRoutingModel = new CallRoutingModel();
            callRoutingModel.projectId = data.projectId;
            callRoutingModel.phoneNumber = data.phoneNumber;
            callRoutingModel.locality = data.locality;
            callRoutingModel.region = data.region;
            callRoutingModel.capabilities = data.capabilities;
            callRoutingModel.price = data.price;
            callRoutingModel.priceUnit = data.priceUnit;
            callRoutingModel.countryCode = data.countryCode;
            callRoutingModel.numberType = data.numberType;
            callRoutingModel.stripeSubscriptionId = data.stripeSubscriptionId;
            callRoutingModel.sid = data.sid;

            const numbers = await callRoutingModel.save();
            return numbers;
        } catch (error) {
            ErrorService.log('callRoutingService.create', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await CallRoutingModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('callRoutingService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const numbers = await CallRoutingModel.findOneAndUpdate(
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
            const stripeSubscriptionId = numbers.stripeSubscriptionId;
            await TwilioService.releasePhoneNumber(
                numbers.projectId,
                numbers.sid
            );
            await PaymentService.removeSubscription(stripeSubscriptionId);
            return numbers;
        } catch (error) {
            ErrorService.log('callRoutingService.deleteBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;
            const callRouting = await CallRoutingModel.findOne(query).sort([
                ['createdAt', -1],
            ]);
            return callRouting;
        } catch (error) {
            ErrorService.log('callRoutingService.findOneBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        try {
            const updatedCallRouting = await CallRoutingModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return updatedCallRouting;
        } catch (error) {
            ErrorService.log('callRoutingService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await CallRoutingModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('callRoutingService.updateMany', error);
            throw error;
        }
    },

    reserveNumber: async function(data, projectId) {
        try {
            let confirmBuy = null;
            const hasCustomTwilioSettings = await TwilioService.hasCustomSettings(
                projectId
            );
            if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                const project = await ProjectService.findOneBy({
                    _id: projectId,
                });
                let owner = project.users.filter(user => user.role === 'Owner');
                owner = owner && owner.length ? owner[0] : owner;
                const user = await UserService.findOneBy({ _id: owner.userId });
                const stripeCustomerId = user.stripeCustomerId;
                const stripeSubscription = await PaymentService.createSubscription(
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
                    const error = new Error('Error Creating Subscription.');
                    error.code = 400;
                    ErrorService.log('callRoutingService.reserveNumber', error);
                    throw error;
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
            const CallRouting = await this.create(data);
            return CallRouting;
        } catch (error) {
            ErrorService.log('callRoutingService.reserveNumber', error);
            throw error;
        }
    },

    findTeamMember: async function(type, id) {
        try {
            let user;
            if (type && type === 'TeamMember') {
                user = await UserService.findOneBy({ _id: id });
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
                } else {
                    return {
                        forwardingNumber: null,
                        error:
                            'Active team have not added their phone numbers yet',
                        userId: user && user._id ? user._id : null,
                    };
                }
            } else if (type && type === 'Schedule') {
                const schedules = await ScheduleService.findOneBy({
                    _id: id,
                });
                const escalationId =
                    schedules &&
                    schedules.escalationIds &&
                    schedules.escalationIds.length
                        ? schedules.escalationIds[0]
                        : null;
                const escalation = escalationId
                    ? await EscalationService.findOneBy({
                          _id: escalationId,
                      })
                    : null;
                const activeTeam =
                    escalation && escalation.activeTeam
                        ? escalation.activeTeam
                        : null;
                if (
                    activeTeam &&
                    activeTeam.teamMembers &&
                    activeTeam.teamMembers.length
                ) {
                    let dutyCheck = 0;
                    for (const teamMember of activeTeam.teamMembers) {
                        const isOnDuty = await AlertService.checkIsOnDuty(
                            teamMember.startTime,
                            teamMember.endTime
                        );
                        const user = await UserService.findOneBy({
                            _id: teamMember.userId,
                        });
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
                        const user = await UserService.findOneBy({
                            _id: activeTeam.teamMembers[0].userId,
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
                            error:
                                'Active team have not added their phone numbers yet',
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
        } catch (error) {
            ErrorService.log('callRoutingService.resolveSchedule', error);
            throw error;
        }
    },

    chargeRoutedCall: async function(projectId, body) {
        try {
            const callSid = body['CallSid'];
            const callStatus = body['CallStatus'] || null;
            const callDetails = await TwilioService.getCallDetails(
                projectId,
                callSid
            );
            if (callDetails && callDetails.price) {
                const duration = callDetails.duration;
                let price = callDetails.price;
                if (price && price.includes('-')) {
                    price = price.replace('-', '');
                }
                price = price * 10;
                const hasCustomTwilioSettings = await TwilioService.hasCustomSettings(
                    projectId
                );
                if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                    const project = await ProjectService.findOneBy({
                        _id: projectId,
                    });
                    let owner = project.users.filter(
                        user => user.role === 'Owner'
                    );
                    owner = owner && owner.length ? owner[0] : owner;
                    await PaymentService.chargeAlert(
                        owner.userId,
                        projectId,
                        price
                    );
                }
                const callRoutingLog = await CallRoutingLogService.findOneBy({
                    callSid,
                });
                if (callRoutingLog && callRoutingLog.callSid) {
                    let dialTo =
                        callRoutingLog.dialTo && callRoutingLog.dialTo.length
                            ? callRoutingLog.dialTo
                            : [];
                    dialTo = dialTo.map(dt => {
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
        } catch (error) {
            ErrorService.log('callRoutingService.chargeRoutedCall', error);
            throw error;
        }
    },

    getCallResponse: async function(data, to, body, backup) {
        try {
            const fromNumber = body['From'];
            const callSid = body['CallSid'];
            const dialCallSid = body['DialCallSid'] || null;
            const callStatus = body['CallStatus'] || null;
            const dialCallStatus = body['DialCallStatus'] || null;
            const routingSchema =
                data && data.routingSchema && data.routingSchema.type
                    ? data.routingSchema
                    : {};
            let memberId = null;
            const response = new twilio.twiml.VoiceResponse();
            let forwardingNumber, error, userId, scheduleId;

            const {
                type,
                id,
                phonenumber,
                backup_type,
                backup_id,
                backup_phonenumber,
                introAudio,
                introtext,
            } = routingSchema;

            if (introtext && introtext.length) {
                response.say(introtext);
            }
            if (introAudio && introAudio.length) {
                response.play(`${global.apiHost}/file/${introAudio}`);
            }

            if (type && !backup) {
                if (id && id.length && type !== 'PhoneNumber') {
                    const result = await this.findTeamMember(type, id);
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
                    const result = await this.findTeamMember(
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
                response.say('Sorry could not find anyone on duty');
            }

            const hasEnoughBalance = await PaymentService.hasEnoughBalance(
                data.projectId,
                forwardingNumber,
                memberId,
                'callRouting'
            );
            if (!hasEnoughBalance) {
                response.reject();
                return response;
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
            const callRoutingLog = await CallRoutingLogService.findOneBy({
                callSid,
            });
            if (callRoutingLog && callRoutingLog.callSid) {
                let dialTo =
                    callRoutingLog.dialTo && callRoutingLog.dialTo.length
                        ? callRoutingLog.dialTo
                        : [];
                dialTo = dialTo.map(dt => {
                    dt.callSid =
                        dialCallSid && dialCallSid.length
                            ? dialCallSid
                            : callSid;
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
        } catch (error) {
            ErrorService.log('callRoutingService.getCallResponse', error);
            throw error;
        }
    },

    getCallRoutingLogs: async function(projectId) {
        try {
            let logs = [];
            const callRouting = await this.findBy({ projectId });
            if (callRouting && callRouting.length) {
                for (let i = 0; i < callRouting.length; i++) {
                    const callRoutingId = callRouting[i]._id;
                    const callLogs = await CallRoutingLogService.findBy({
                        callRoutingId,
                    });
                    if (callLogs && callLogs.length) {
                        logs = logs.concat(callLogs);
                    }
                }
            }
            return logs;
        } catch (error) {
            ErrorService.log('callRoutingService.getCallRoutingLogs', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await CallRoutingModel.deleteMany(query);
            return 'Call routing Number(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('callRoutingService.hardDeleteBy', error);
            throw error;
        }
    },
};

const CallRoutingModel = require('../models/callRouting');
const CallRoutingLogService = require('../services/callRoutingLogService');
const PaymentService = require('./paymentService');
const TwilioService = require('./twilioService');
const ScheduleService = require('./scheduleService');
const AlertService = require('./alertService');
const EscalationService = require('./escalationService');
const UserService = require('./userService');
const twilio = require('twilio');
const { IS_SAAS_SERVICE } = require('../config/server');
const ErrorService = require('./errorService');
const ProjectService = require('./projectService');
