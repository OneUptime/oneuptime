
/**
 *
 * Copyright HackerBay, Inc.
 *
 */
module.exports = {
    findOneBy: async function (query) {
        try {
            const gfs = await Grid(mongoose.connection.db, mongoose.mongo);
            gfs.collection('uploads');
            if(!query){
                query = {};
            }
            // query.deleted = false;
            const file = await gfs.files.findOne(query);
            if (!file) {
                const error = new Error('File is not found.');
                error.code = 400;
                throw error;
            }
            return file;
        } catch (error) {
            ErrorService.log('fileService.findOneBy', error);
            throw error;
        }
    }
};

const mongoose = require('../config/db');
const Grid = require('gridfs-stream');
const ErrorService = require('./errorService');