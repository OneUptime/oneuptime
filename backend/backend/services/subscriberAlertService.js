module.exports = {
    create: async function (data) {
        var subscriberAlertModel = new SubscriberAlertModel();
        subscriberAlertModel.projectId = data.projectId || null;
        subscriberAlertModel.subscriberId = data.subscriberId || null;
        subscriberAlertModel.incidentId = data.incidentId || null;
        subscriberAlertModel.alertVia = data.alertVia || null;
        subscriberAlertModel.alertStatus = data.alertStatus || null;
        try{
            var subscriberAlert = await subscriberAlertModel.save();
        }catch(error){
            ErrorService.log('subscriberAlertModel.save', error);
            throw error;
        }
        return subscriberAlert;
    },

    update: async function(subscriberAlertId, projectId, data){
        let _this = this;
        try {
            if(!data._id){
                let subscriberAlert = await _this.create(data);
                return subscriberAlert;
            }else{
                var subscriberAlert = await _this.findByOne({_id: data._id});
                
                let incidentId = data.incidentId || subscriberAlert.incidentId;
                let subscriberId = data.subscriberId || subscriberAlert.subscriberId;
                let alertVia = data.alertVia || subscriberAlert.alertVia;
                let alertStatus = data.alertStatus || subscriberAlert.alertStatus;
                
                //find and update
                subscriberAlert = await SubscriberAlertModel.findByIdAndUpdate(data._id,{
                    $set:{
                        projectId: projectId,
                        subscriberId: subscriberId,
                        alertVia: alertVia,
                        alertStatus: alertStatus,
                        incidentId: incidentId
                    }
                }, {
                    new: true
                });
                
                return subscriberAlert;
            }
        } catch (error) {
            ErrorService.log('SubscriberAlertService.update', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId){
        try{
            var subscriberAlert = await SubscriberAlertModel.findOneAndUpdate(query, {
                $set:{
                    deleted:true,
                    deletedById:userId,
                    deletedAt:Date.now()
                }
            },{
                new: true
            });
        }catch(error){
            ErrorService.log('SubscriberAlertModel.findOneAndUpdate', error);
            throw error;
        }
        return subscriberAlert;
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
            var subscriberAlerts = await SubscriberAlertModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('subscriberId','name contactEmail contactPhone contactWebhook')
                .populate('incidentId', 'name');
        }catch(error){
            ErrorService.log('SubscriberAlertModel.find', error);
            throw error;
        }

        return subscriberAlerts;
    },

    findByOne: async function(query){
        if(!query){
            query = {};
        }

        query.deleted = false;
        try{
            var subscriberAlert = await SubscriberAlertModel.find(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate('subscriberId','name')
                .populate('incidentId', 'name');
        }catch(error){
            ErrorService.log('SubscriberAlertModel.find', error);
            throw error;
        }
        return subscriberAlert;
    },

    countBy: async function (query) {

        if(!query){
            query = {};
        }

        query.deleted = false;
        try{
            var count = await SubscriberAlertModel.count(query);
        }catch(error){
            ErrorService.log('SubscriberAlertModel.count', error);
            throw error;
        }
        return count;

    },

    hardDeleteBy: async function(query){
        try{
            await SubscriberAlertModel.deleteMany(query);
        }catch(error){
            ErrorService.log('SubscriberAlertModel.deleteMany', error);
            throw error;
        }
        return 'Subscriber Alert(s) removed successfully';
    },
};

var SubscriberAlertModel = require('../models/subscriberAlert');
var ErrorService = require('./errorService');

