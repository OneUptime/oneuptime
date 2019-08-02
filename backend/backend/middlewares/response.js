/* eslint-disable no-console */
/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');
var Grid = require('gridfs-stream');
var JsonToCsv = require('./jsonToCsv');

module.exports = {

    sendEmptyResponse(req, res) {
        //purge request.
        //req = null;
        return res.status(200).send();
    },


    sendFileResponse(req, res, file) {
        /** create read stream */

        var gfs = Grid(mongoose.connection.db, mongoose.mongo);
        gfs.collection('uploads');

        var readstream = gfs.createReadStream({ _id: file._id, root: 'uploads' });

        /** set the proper content type */
        res.set('Content-Type', file.contentType);
        res.status(200);
        /** return response */
        readstream.pipe(res);
    },

    sendErrorResponse: function (req, res, error) {
        //purge request.
        //req = null;
        if (error.statusCode && error.message) {
            return res.status(error.statusCode).send({ message: error.message });
        }

        else if (error.code && error.message && typeof error.code === 'number') {
            return res.status(error.code).send({ message: error.message });
        } else if (error instanceof mongoose.Error.CastError){
            return res.status(400).send({ code: 400, message: 'Input data schema mismatch.' });
        }
        else {
            return res.status(500).send({ message: 'Server Error.' });
        }
    },

    sendListResponse: async function (req, res, list, count) {

        var response = {};
        if (!list){
            list=[];
        }

        if (list) {
            response.data = list;
        }

        if (count) {
            response.count = count;
        } else {
            if (list)
                response.count = list.length;
        }

        if (req.query.skip) {
            response.skip = parseInt(req.query.skip);
        }


        if (req.query.limit) {
            response.limit = parseInt(req.query.limit);
        }

        //purge request.
        //req = null;
        if (req.query['output-type'] === 'csv') {
            if (!Array.isArray(response.data)) {
                let properties = Object.keys(response.data);
                let newObj = {};
                properties.forEach(prop=>{
                    if(typeof response.data[[prop]] === 'object' && response.data[[prop]] !== null){
                        if(response.data[[prop]].name) response.data[[prop]] = response.data[[prop]].name;
                        else if(response.data[[prop]].title) response.data[[prop]] = response.data[[prop]].title;
                        else if(response.data[[prop]]._id) response.data[[prop]] = response.data[[prop]]._id;
                    }
                    newObj[[prop]] = response.data[[prop]];
                });
                response.data = JSON.parse(JSON.stringify(newObj));
                response.data = [response.data];
            }
            else {
                response.data = response.data.map(i => { 
                    i = i._doc ? i._doc : i;
                    let properties = Object.keys(i);
                    let newObj = {};
                    properties.forEach(prop=>{
                        if(typeof i[[prop]] === 'object' && i[[prop]] !== null){
                            if(i[[prop]].name) i[[prop]] = i[[prop]].name;
                            else if(i[[prop]].title) i[[prop]] = i[[prop]].title;
                            else if(i[[prop]]._id) i[[prop]] = i[[prop]]._id;
                        }
                        newObj[[prop]] = i[[prop]];
                    });
                    return JSON.parse(JSON.stringify(newObj));
                });
            }
            
            response.data = await JsonToCsv.ToCsv(response.data);
        }

        return res.status(200).send(response);
    },

    async sendItemResponse(req, res, item) {
        //purge request.
        // req = null;

        if (req.query['output-type'] === 'csv') {
            if (!Array.isArray(item)) {
                let properties = Object.keys(item);
                let newObj = {};
                properties.forEach(prop=>{
                    if(typeof item[[prop]] === 'object' && item[[prop]] !== null){
                        if(item[[prop]].name) item[[prop]] = item[[prop]].name;
                        else if(item[[prop]].title) item[[prop]] = item[[prop]].title;
                        else if(item[[prop]]._id) item[[prop]] = item[[prop]]._id;
                    }
                    newObj[[prop]] = item[[prop]];
                });
                item = JSON.parse(JSON.stringify(newObj));
                item = [item];
            }
            else {
                item = item.map(i => {
                    i = i._doc ? i._doc : i;
                    let properties = Object.keys(i);
                    let newObj = {};
                    properties.forEach(prop=>{
                        if(typeof i[[prop]] === 'object' && i[[prop]] !== null){
                            if(i[[prop]].name) i[[prop]] = i[[prop]].name;
                            else if(i[[prop]].title) i[[prop]] = i[[prop]].title;
                            else if(i[[prop]]._id) i[[prop]] = i[[prop]]._id;
                        }
                        newObj[[prop]] = i[[prop]];
                    });
                    return JSON.parse(JSON.stringify(newObj));
                });
            }
            item = await JsonToCsv.ToCsv(item);
        }

        return res.status(200).send(item);
    }
};