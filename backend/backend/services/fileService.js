
/**
 *
 * Copyright HackerBay, Inc.
 *
 */
module.exports = {
    findOneBy: async function (query) {
        try {
            var gfs = await Grid(mongoose.connection.db, mongoose.mongo);
            gfs.collection('uploads');
            if(!query){
                query = {};
            }
            // query.deleted = false;
            var file = await gfs.files.findOne(query);
            if (!file) {
                let error = new Error('File is not found.');
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

var mongoose = require('../config/db');
var Grid = require('gridfs-stream');
var ErrorService = require('./errorService');