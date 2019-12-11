module.exports = {
    create: async function (data) {
        try {
            var smsTemplateModel = new SmsTemplateModel();
            smsTemplateModel.projectId = data.projectId || null;
            smsTemplateModel.body = data.body || null;
            smsTemplateModel.smsType = data.smsType || null;
            smsTemplateModel.allowedVariables = smsTemplateVariables[[data.smsType]];
            var smsTemplate = await smsTemplateModel.save();

            return smsTemplate;
        } catch (error) {
            ErrorService.log('smsTemplateService.create', error);
            throw error;
        }
    },

    update: async function(data){
        try {
            let _this = this;
            if (!data._id) {
                let smsTemplate = await _this.create(data);
                return smsTemplate;  
            } else {
                var smsTemplate = await _this.findOneBy({_id: data._id});

                let body = data.body || smsTemplate.body;
                let smsType = data.smsType || smsTemplate.smsType;
                let allowedVariables = smsTemplateVariables[[data.smsType || smsTemplate.smsType || []]];

                var updatedSmsTemplate = await SmsTemplateModel.findByIdAndUpdate(data._id, {
                    $set: {
                        body: body,
                        allowedVariables: allowedVariables,
                        smsType: smsType
                    }
                }, {
                    new: true
                });

                return updatedSmsTemplate;
            }
        } catch (error) {
            ErrorService.log('smsTemplateService.update', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId){
        try {
            var smsTemplate = await SmsTemplateModel.findOneAndUpdate(query, {
                $set:{
                    deleted:true,
                    deletedById:userId,
                    deletedAt:Date.now()
                }
            },{
                new: true
            });
            return smsTemplate;
        } catch (error) {
            ErrorService.log('smsTemplateService.deleteBy', error);
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
            var smsTemplates = await SmsTemplateModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name');
            return smsTemplates;
        } catch(error) {
            ErrorService.log('smsTemplateService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function(query){
        try {
            if(!query){
                query = {};
            }
    
            query.deleted = false;
            var smsTemplate = await SmsTemplateModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name');
            return smsTemplate;
        } catch (error) {
            ErrorService.log('smsTemplateService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try{
            if(!query){
                query = {};
            }
    
            query.deleted = false;
            var count = await SmsTemplateModel.count(query);
            return count;
        }catch(error){
            ErrorService.log('smsTemplateService.countBy', error);
            throw error;
        }
    },

    getTemplates: async function (projectId){
        try {
            let _this = this;
            var templates = await Promise.all(defaultSmsTemplate.map(async (template)=>{
                var smsTemplate = await _this.findOneBy({projectId: projectId, smsType: template.smsType});
                return smsTemplate != null && smsTemplate != undefined ? smsTemplate : template;
            }));
            return templates;
        } catch (error) {
            ErrorService.log('smsTemplateService.getTemplates', error);
            throw error;
        }
    },

    resetTemplate: async function(projectId, templateId){
        let _this = this;
        var oldTemplate = await _this.findOneBy({_id: templateId});
        var newTemplate = defaultSmsTemplate.filter(template => template.smsType === oldTemplate.smsType)[0];
        var resetTemplate = await _this.update({
            _id: oldTemplate._id, 
            smsType: newTemplate.smsType,
            body: newTemplate.body,
            allowedVariables: newTemplate.allowedVariables
        });
        return resetTemplate;
    },

    hardDeleteBy: async function(query){
        try {
            await SmsTemplateModel.deleteMany(query);
            return 'SMS Template(s) removed successfully';
        } catch (error) {
            ErrorService.log('smsTemplateService.hardDeleteBy', error);
            throw error;
        }
    },
};

var SmsTemplateModel = require('../models/smsTemplate');
var ErrorService = require('./errorService');
var smsTemplateVariables = require('../config/smsTemplateVariables');
var defaultSmsTemplate = require('../config/smsTemplate');
