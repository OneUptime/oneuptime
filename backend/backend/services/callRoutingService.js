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
            const confirmBuy = await TwilioService.buyPhoneNumber(
                data.projectId,
                data.phoneNumber
            );
            const hasCustomTwilioSettings = await TwilioService.hasCustomSettings(
                projectId
            );
            if (
                IS_SAAS_SERVICE &&
                !hasCustomTwilioSettings &&
                confirmBuy &&
                confirmBuy.sid
            ) {
                const project = ProjectService.findOneBy({ _id: projectId });
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
            }
            data.sid = confirmBuy.sid;
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

    getCallResponse: async function(data, fromNumber, to) {
        try {
            let memberId = null;
            const response = new twilio.twiml.VoiceResponse();

            if (
                data &&
                data.routingSchema &&
                data.routingSchema.type &&
                data.routingSchema.type.length &&
                data.routingSchema.id &&
                data.routingSchema.id.length
            ) {
                const {
                    forwardingNumber,
                    error,
                    userId,
                } = await this.findTeamMember(
                    data.routingSchema.type,
                    data.routingSchema.id
                );
                if (userId) {
                    memberId = userId;
                }
                if (forwardingNumber && (!error || (error && error.length))) {
                    response.dial(forwardingNumber);
                } else if (!forwardingNumber && error && error.length) {
                    response.say(error);
                }
            } else {
                response.say('Sorry could not find anyone on duty');
            }
            if (data && data._id) {
                await CallRoutingLogService.create({
                    callRoutingId: data && data._id ? data._id : null,
                    calledFrom: fromNumber,
                    calledTo: to,
                    userId: memberId,
                    scheduleId:
                        data &&
                        data.routingSchema &&
                        data.routingSchema.type &&
                        data.routingSchema.id &&
                        data.routingSchema.type === 'Schedule'
                            ? data.routingSchema.id
                            : '',
                });
            }
            response.say('Goodbye');
            return response;
        } catch (error) {
            ErrorService.log('callRoutingService.getCallResponse', error);
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
