const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
const getSlug = require('../utils/getSlug');
const mongoose = require('../config/db');

class ModelUtil {

    constructor({ model, friendlyName = '' }) {

        if(!model){
            throw new Error("model is required");
        }

        if(!model instanceof mongoose.model){
            throw new Error("model should be an instance of mongoose model");
        }

        this.Model = model;
        this.FriendlyName = friendlyName; 
    }

    async create({ 
        data = {}, 
        checkDuplicates: {
            valuesIn = [], 
            byProject = true
        },
        slugify = '' // which field to slugify
    }) {
        const item = new this.Model();

        if (valuesIn && valuesIn.length > 0) {

            const countQuery = {};

            if(byProject){
                countQuery.projectId = data.projectId; 
            }

            if(typeof valuesIn === "string"){
                valuesIn = [valuesIn];
            }

            for(const duplicateValueIn of valuesIn){
                countQuery[duplicateValueIn] = data[duplicateValueIn]; 
            }

            const existingItemCount = await this.countBy({
                query: countQuery
            });

            if(existingItemCount > 0){
                const error = new Error(
                    `${this.FriendlyName || `Item`} with the same ${checkDuplicatesValuesIn.join(',')} already exists.`
                );
                error.code = 400;
                throw error;
            }       
        }

        for (let key in data) {
            item[key] = data[key];
        }

        if(slugify && data[slugify]){
            item.slug = getSlug(data[slugify]);
        }

        return await item.save();
    }

    async countBy({ query = {} }) {
        query.deleted = false;
        const count = await this.Model.countDocuments(query);
        return count;
    }

    async deleteBy({ query = {}, multiple = false }) {

        query.deleted = false;

        const set = {
            deleted: true,
            deletedById: userId,
            deletedAt: Date.now(),
        };

        let functionToCall = 'findOneAndUpdate'

        if (multiple) {
            functionToCall = 'findAndUpdate'
        }

        return await this.Model[functionToCall](
            query,
            {
                $set: set,
            },
            {
                new: true,
            }
        );
    }

    async findBy({ 
        query = {}, 
        skip = 0, 
        limit = 10, 
        populate = [], 
        select = '', 
        sort = [['createdAt', -1]], 
        findOne = false 
    }) {

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        query.deleted = false;

        let functionToCall = 'find';

        if (findOne) {
            functionToCall = 'findOne';
        }

        query = this.Model[functionToCall](query)
            .sort(sort)
            .limit(limit)
            .skip(skip)
            .lean();

        query = handleSelect(select, query);
        query = handlePopulate(populate, query);

        const items = await query;
        return items;
    }

    async findOneBy({ query = {}, skip = 0, limit = 1, populate = [], select = '', sort = [] }) {
        return await this.findBy({ query, skip, limit, populate, select, sort, findOne: true })
    }

    async updateBy({ query = {}, updatedValues = {}, multiple = true }) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        let functionToCall = 'updateMany'

        if (multiple) {
            functionToCall = 'updateOne'
        }

        let updatedItems = await this.Model[functionToCall](query, {
            $set: updatedValues,
        });

        return updatedItems;
    }

    async updateOneBy({ query = {}, updatedValues = {} }) {
        return await this.updateBy({ query, updatedValues, updateOne = true })
    }


}

module.exports = ModelUtil;