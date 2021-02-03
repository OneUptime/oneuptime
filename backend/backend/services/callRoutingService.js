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

    reserveNumber: async function(data, userId) {
        try {
            const user = await UserService.findOneBy({ _id: userId });
            const stripeCustomerId = user.stripeCustomerId;
            const confirmBuy = await TwilioService.buyPhoneNumber(
                data.projectId,
                data.phoneNumber
            );
            const stripeSubscription = await PaymentService.createSubscription(
                stripeCustomerId,
                data.price
            );
            const stripeSubscriptionId =
                stripeSubscription && stripeSubscription.id
                    ? stripeSubscription.id
                    : null;
            if (stripeSubscriptionId && stripeSubscriptionId.length) {
                data.stripeSubscriptionId = stripeSubscriptionId;
                data.sid = confirmBuy.sid;
                const CallRouting = await this.create(data);
                return CallRouting;
            } else {
                const error = new Error('Error Creating Subscription.');
                error.code = 400;
                ErrorService.log('callRoutingService.reserveNumber', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('callRoutingService.reserveNumber', error);
            throw error;
        }
    },

    resolveSchedule: async function(type, id) {
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

    getTeamAndSchedules: async function(projectId) {
        try {
            const teams = await TeamService.getTeamMembersBy({
                _id: projectId,
            });
            const schedules = await ScheduleService.findBy(
                {
                    projectId: projectId,
                },
                0,
                0
            );
            return { teams, schedules };
        } catch (error) {
            ErrorService.log('callRoutingService.reserveNumber', error);
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
const PaymentService = require('./paymentService');
const TwilioService = require('./twilioService');
const TeamService = require('./teamService');
const ScheduleService = require('./scheduleService');
const AlertService = require('./alertService');
const EscalationService = require('./escalationService');
const UserService = require('./userService');
const ErrorService = require('./errorService');
