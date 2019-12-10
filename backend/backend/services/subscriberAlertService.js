module.exports = {
    create: async function (data) {
        try {
            var subscriberAlertModel = new SubscriberAlertModel();
            subscriberAlertModel.projectId = data.projectId || null;
            subscriberAlertModel.subscriberId = data.subscriberId || null;
            subscriberAlertModel.incidentId = data.incidentId || null;
            subscriberAlertModel.alertVia = data.alertVia || null;
            subscriberAlertModel.alertStatus = data.alertStatus || null;
            var subscriberAlert = await subscriberAlertModel.save();
            return subscriberAlert;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.create', error);
            throw error;
        }
    },

    update: async function(subscriberAlertId, projectId, data){
        try {
            let _this = this;
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
        try {
            var subscriberAlert = await SubscriberAlertModel.findOneAndUpdate(query, {
                $set:{
                    deleted:true,
                    deletedById:userId,
                    deletedAt:Date.now()
                }
            },{
                new: true
            });
            return subscriberAlert;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function(query, skip, limit){
        try {
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
            var subscriberAlerts = await SubscriberAlertModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('subscriberId','name contactEmail contactPhone contactWebhook')
                .populate('incidentId', 'name');
            return subscriberAlerts;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.findBy', error);
            throw error;
        }
    },

    findByOne: async function(query){
        try {
            if (!query) {
                query = {};
            }
    
            query.deleted = false;
            var subscriberAlert = await SubscriberAlertModel.find(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate('subscriberId','name')
                .populate('incidentId', 'name');
            return subscriberAlert;
        } catch(error) {
            ErrorService.log('SubscriberAlertService.findByOne', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if(!query){
                query = {};
            }
    
            query.deleted = false;
            var count = await SubscriberAlertModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('SubscriberAlertService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query){
        try {
            await SubscriberAlertModel.deleteMany(query);
            return 'Subscriber Alert(s) removed successfully';
        } catch (error) {
            ErrorService.log('SubscriberAlertService.hardDeleteBy', error);
            throw error;
        }
    },
};

var SubscriberAlertModel = require('../models/subscriberAlert');
var ErrorService = require('./errorService');
