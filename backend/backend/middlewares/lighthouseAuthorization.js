/**
 *
 * Copyright HackerBay, Inc.
 *
 */
 const LighthouseService = require('../services/lighthouseService');
 const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
 const ErrorService = require('../services/errorService');
 const CLUSTER_KEY = process.env.CLUSTER_KEY;
 module.exports = {
     isAuthorizedLighthouse: async function (req, res, next) {

         try {
             let lighthouseKey, lighthouseName, clusterKey, lighthouseVersion;
 
             if (req.params.lighthousekey) {
                 lighthouseKey = req.params.lighthousekey;
             } else if (req.query.lighthouseKey) {
                 lighthouseKey = req.query.lighthousekey;
             } else if (req.headers['lighthousekey']) {
                 lighthouseKey = req.headers['lighthousekey'];
             } else if (req.headers['lighthousekey']) {
                 lighthouseKey = req.headers['lighthousekey'];
             } else if (req.body.lighthouseKey) {
                 lighthouseKey = req.body.lighthouseKey;
             } else {
                 return sendErrorResponse(req, res, {
                     code: 400,
                     message: 'lighthouse Key not found.',
                 });
             }
 
             if (req.params.lighthousename) {
                 lighthouseName = req.params.lighthousename;
             } else if (req.query.lighthousename) {
                 lighthouseName = req.query.lighthousename;
             } else if (req.headers['lighthousename']) {
                 lighthouseName = req.headers['lighthousename'];
             } else if (req.headers['lighthousename']) {
                 lighthouseName = req.headers['lighthousename'];
             } else if (req.body.lighthouseName) {
                 lighthouseName = req.body.lighthousename;
             } else {
                 return sendErrorResponse(req, res, {
                     code: 400,
                     message: 'lighthouse Name not found.',
                 });
             }
 
             if (req.params.clusterKey) {
                 clusterKey = req.params.clusterkey;
             } else if (req.query.clusterKey) {
                 clusterKey = req.query.clusterkey;
             } else if (req.headers['clusterKey']) {
                 clusterKey = req.headers['clusterKey'];
             } else if (req.headers['clusterkey']) {
                 clusterKey = req.headers['clusterkey'];
             } else if (req.body.clusterKey) {
                 clusterKey = req.body.clusterKey;
             }
 
             if (req.params.lighthouseversion) {
                 lighthouseVersion = req.params.lighthouseversion;
             } else if (req.query.lighthouseversion) {
                 lighthouseVersion = req.query.lighthouseversion;
             } else if (req.headers['lighthouseversion']) {
                 lighthouseVersion = req.headers['lighthouseversion'];
             } else if (req.body.lighthouseversion) {
                 lighthouseVersion = req.body.lighthouseversion;
             }
             
             let lighthouse = null;
 
             if (clusterKey && clusterKey === CLUSTER_KEY) {
                 // if cluster key matches then just query by lighthouse name,
                 // because if the lighthouse key does not match, we can update lighthouse key later
                 // without updating mongodb database manually.
                 lighthouse = await LighthouseService.findOneBy({ lighthouseName });
             } else {
                 lighthouse = await LighthouseService.findOneBy({ lighthouseKey, lighthouseName });
             }
 
             if (!lighthouse && (!clusterKey || clusterKey !== CLUSTER_KEY)) {
                 return sendErrorResponse(req, res, {
                     code: 400,
                     message: 'lighthouse key and lighthouse name do not match.',
                 });
             }
 
             if (!lighthouse) {
                 //create a new lighthouse.
                 lighthouse = await LighthouseService.create({
                     lighthouseKey,
                     lighthouseName,
                     lighthouseVersion,
                 });
             }
 
             if (lighthouse.lighthouseKey !== lighthouseKey) {
                 //update lighthouse key becasue it does not match.
                 await LighthouseService.updateOneBy(
                     {
                         lighthouseName,
                     },
                     { lighthouseKey }
                 );
             }
             req.lighthouse = {};
             req.lighthouse.id = lighthouse._id;
             //await LighthouseService.updateLighthouseStatus(lighthouse._id);
 
             //Update lighthouse version
             const lighthouseValue = await LighthouseService.findOneBy({
                 lighthouseKey,
                 lighthouseName,
             });
 
             if (!lighthouseValue.version || lighthouseValue.version !== lighthouseVersion) {
                 await LighthouseService.updateOneBy(
                     {
                         lighthouseName,
                     },
                     { version: lighthouseVersion }
                 );
             }
 
             next();
         } catch (error) {
             ErrorService.log('lighthouseAuthorization.isAuthorizedLighthouse', error);
             throw error;
         }
     },
 };
 