module.exports = {
    create: async function (data) {

        var smsTemplateModel = new SmsTemplateModel();
        smsTemplateModel.projectId = data.projectId || null;
        smsTemplateModel.body = data.body || null;
        smsTemplateModel.smsType = data.smsType || null;
        smsTemplateModel.allowedVariables = smsTemplateVariables[[data.smsType]];
        try{
            var smsTemplate = await smsTemplateModel.save();
        }catch(error){
            ErrorService.log('smsTemplateModel.save', error);
            throw error;
        }
        return smsTemplate;
    },

    update: async function(data){
        let _this = this;
        if(!data._id){
            try{
                let smsTemplate = await _this.create(data);
                return smsTemplate;
            }catch(error){
                ErrorService.log('SmsTemplateService.create', error);
                throw error;
            }
        }else{
            try{
                var smsTemplate = await _this.findOneBy({_id: data._id});
            }catch(error){
                ErrorService.log('SmsTemplateService.findByOne', error);
                throw error;
            }
            let body = data.body || smsTemplate.body;
            let smsType = data.smsType || smsTemplate.smsType;
            let allowedVariables = smsTemplateVariables[[data.smsType || smsTemplate.smsType || []]];
            try{
                var updatedSmsTemplate = await SmsTemplateModel.findByIdAndUpdate(data._id, {
                    $set: {
                        body: body,
                        allowedVariables: allowedVariables,
                        smsType: smsType
                    }
                }, {
                    new: true
                });
            }catch(error){
                ErrorService.log('SmsTemplateModel.findByIdAndUpdate', error);
                throw error;
            }

            return updatedSmsTemplate;
        }
    },

    deleteBy: async function(query, userId){
        try{
            var smsTemplate = await SmsTemplateModel.findOneAndUpdate(query, {
                $set:{
                    deleted:true,
                    deletedById:userId,
                    deletedAt:Date.now()
                }
            },{
                new: true
            });
        }catch(error){
            ErrorService.log('SmaTemplateModel.findOneAndUpdate', error);
            throw error;
        }
        return smsTemplate;
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
            var smsTemplates = await SmsTemplateModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name');
        }catch(error){
            ErrorService.log('SmsTemplateModel.find', error);
            throw error;
        }

        return smsTemplates;
    },

    findOneBy: async function(query){
        if(!query){
            query = {};
        }

        query.deleted = false;
        try{
            var smsTemplate = await SmsTemplateModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name');
        }catch(error){
            ErrorService.log('SmaTemplateModel.findOne', error);
            throw error;
        }

        return smsTemplate;
    },

    countBy: async function (query) {

        if(!query){
            query = {};
        }

        query.deleted = false;
        try{
            var count = await SmsTemplateModel.count(query);
        }catch(error){
            ErrorService.log('SmsTemplateModel.count', error);
            throw error;
        }
        return count;
    },

    getTemplates: async function (projectId){
        let _this = this;
        var templates = await Promise.all(defaultSmsTemplate.map(async (template)=>{
            try{
                var smsTemplate = await _this.findOneBy({projectId: projectId, smsType: template.smsType});
            }catch(error){
                ErrorService.log('SmsTemplateService.findOneBy', error);
                throw error;
            }
            return smsTemplate != null && smsTemplate != undefined ? smsTemplate : template;
        }));
        return templates;
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
        try{
            await SmsTemplateModel.deleteMany(query);
        }catch(error){
            ErrorService.log('SmsTemplateModel.deleteMany', error);
            throw error;
        }
        return 'SMS Template(s) removed successfully';
    },
};

var SmsTemplateModel = require('../models/smsTemplate');
var ErrorService = require('./errorService');
var smsTemplateVariables = require('../config/smsTemplateVariables');
var defaultSmsTemplate = require('../config/smsTemplate');
