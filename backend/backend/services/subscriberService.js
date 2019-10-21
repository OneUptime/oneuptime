module.exports = {
    create: async function (data) {
        var _this = this;
        var subscriberModel = new SubscriberModel();
        subscriberModel.projectId = data.projectId || null;
        subscriberModel.monitorId = data.monitorId || null;
        subscriberModel.statusPageId = data.statusPageId || null;
        subscriberModel.alertVia = data.alertVia || null;
        subscriberModel.contactEmail = data.contactEmail || null;
        subscriberModel.contactPhone = data.contactPhone || null;
        subscriberModel.countryCode = data.countryCode || null;
        subscriberModel.contactWebhook = data.contactWebhook || null;
        try{
            var subscriber = await subscriberModel.save();
        }catch(error){
            ErrorService.log('subscriberModel.save', error);
            throw error;
        }
        return await _this.findByOne({_id: subscriber._id});
    },

    update: async function(data){
        let _this = this;
        if(!data._id){
            try{
                let subscriber = await _this.create(data);
                return subscriber;
            }catch(error){
                ErrorService.log('SubscriberService.create', error);
                throw error;
            }
        }else{
            try{
                var subscriber = await _this.findByOne({_id: data._id});
            }catch(error){
                ErrorService.log('SubscriberService.findByOne', error);
                throw error;
            }
            let monitorId = data.monitorId || subscriber.monitorId;
            let statusPageId = data.statusPageId || subscriber.statusPageId;
            let alertVia = data.alertVia || subscriber.alertVia;
            let contactEmail = data.contactEmail || subscriber.contactEmail;
            let contactPhone = data.contactPhone || subscriber.contactPhone;
            try{
                var updatedSubscriber = await SubscriberModel.findByIdAndUpdate(data._id, {
                    $set: {
                        statusPageId: statusPageId,
                        monitorId: monitorId,
                        alertVia: alertVia,
                        contactEmail: contactEmail,
                        contactPhone: contactPhone
                    }
                }, {
                    new: true
                });
            }catch(error){
                ErrorService.log('SubscriberModel.findByIdAndUpdate', error);
                throw error;
            }

            return updatedSubscriber;
        }
    },

    deleteBy: async function(query, userId){
        try{
            var subscriber = await SubscriberModel.findOneAndUpdate(query, {
                $set:{
                    deleted:true,
                    deletedById:userId,
                    deletedAt:Date.now()
                }
            },{
                new: true
            });
        }catch(error){
            ErrorService.log('SubscriberModel.findOneAndUpdate', error);
            throw error;
        }
        return subscriber;
    },

    findBy: async function(query, skip, limit){
        if(!skip) skip=0;

        if(!limit) limit=10;

        if(typeof(skip) === 'string'){
            skip = parseInt(skip);
        }

        if(typeof(limit) === 'string'){
            limit = parseInt(limit);
        }

        if(!query){
            query = {};
        }

        query.deleted = false;

        try{
            var subscribers = await SubscriberModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('monitorId','name')
                .populate('statusPageId','title');
        }catch(error){
            ErrorService.log('SubscriberModel.find', error);
            throw error;
        }

        return subscribers;
    },

    subscribe: async function(data, monitors){
        var _this = this;
        var success = monitors.map(async monitor => {
            try{
                let newSubscriber = Object.assign({}, data, { monitorId: monitor });
                let hasSubscribed = await _this.subscriberCheck(newSubscriber);
                if(hasSubscribed){
                    let error = new Error('You are already subscribed to this monitor.');
                    error.code = 400;
                    ErrorService.log('SubscriberService.subscribe', error);
                    throw error;
                }else{
                    return await _this.create(newSubscriber);
                }
            }catch(error){
                ErrorService.log('SubscriberService.create', error);
                throw error;
            }
        });
        var subscriber = await Promise.all(success);
        return subscriber;
    },

    subscriberCheck: async function(subscriber){
        var _this = this;
        var existingSubscriber = null;
        if(subscriber.alertVia === 'sms'){
            existingSubscriber = await _this.findByOne({monitorId: subscriber.monitorId, contactPhone: subscriber.contactPhone, countryCode: subscriber.countryCode});
        }else if(subscriber.alertVia === 'email'){
            existingSubscriber = await _this.findByOne({monitorId: subscriber.monitorId, contactEmail: subscriber.contactEmail});
        }else if(subscriber.alertVia === 'webhook'){
            existingSubscriber = await _this.findByOne({monitorId: subscriber.monitorId, contactWebhook: subscriber.contactWebhook, contactEmail: subscriber.contactEmail});
        }
        return existingSubscriber !== null ? true : false;
    },

    findByOne: async function(query){
        if(!query){
            query = {};
        }

        query.deleted = false;
        try{
            var subscriber = await SubscriberModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate('monitorId','name');
        }catch(error){
            ErrorService.log('SubscriberModel.findOne', error);
            throw error;
        }

        return subscriber;
    },

    countBy: async function (query) {

        if(!query){
            query = {};
        }

        query.deleted = false;
        try{
            var count = await SubscriberModel.count(query);
        }catch(error){
            ErrorService.log('SubscriberModel.count', error);
            throw error;
        }
        return count;
    },

    removeBy: async function(query){
        try{
            await SubscriberModel.deleteMany(query);
        }catch(error){
            ErrorService.log('SubscriberModel.deleteMany', error);
            throw error;
        }
        return 'Subscriber(s) removed successfully';
    },

    hardDeleteBy: async function(query){
        try{
            await SubscriberModel.deleteMany(query);
        }catch(error){
            ErrorService.log('SubscriberModel.deleteMany', error);
            throw error;
        }
        return 'Subscriber(s) removed successfully';
    },
    restoreBy: async function (query){
        const _this = this;
        query.deleted = true;
        let subscriber = await _this.findBy(query);
        if(subscriber && subscriber.length > 1){
            const subscribers = await Promise.all(subscriber.map(async (subscriber) => {
                const subscriberId = subscriber._id;
                subscriber = await _this.update({_id: subscriberId, deleted: true}, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return subscriber;
            }));
            return subscribers;
        }else{
            subscriber = subscriber[0];
            if(subscriber){
                const subscriberId = subscriber._id;
                subscriber = await _this.update({_id: subscriberId, deleted: true}, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
            }
            return subscriber;
        }
    }
};

var SubscriberModel = require('../models/subscriber');
var ErrorService = require('./errorService');
