
/**
 *
 * Copyright HackerBay, Inc.
 *
 */
module.exports = {
    findOneBy: async function (query) {
        try{
            var gfs = await Grid(mongoose.connection.db, mongoose.mongo);
        }catch(error){
            ErrorService.log('Grid(mongoose.connection.db, mongoose.mongo)', error);
            throw error;
        }
        gfs.collection('uploads');
        if(!query){
            query = {};
        }
        // query.deleted = false;
        try{
            var file = await gfs.files.findOne(query);
        }catch(error){
            ErrorService.log('gfs.files.findOne', error);
            throw error;
        }
        if (!file) {
            let error = new Error('File is not found.');
            error.code = 400;
            throw error;
        }
        return file;
    }
};

var mongoose = require('../config/db');
var Grid = require('gridfs-stream');
var ErrorService = require('./errorService');