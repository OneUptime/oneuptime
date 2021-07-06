/**
 *
 * Copyright HackerBay, Inc.
 *
 */

 const express = require('express');
 const ApplicationScannerService = require('../services/applicationScannerService');
 const ApplicationSecurityService = require('../services/applicationSecurityService');
 const ApplicationSecurityLogService = require('../services//applicationSecurityLogService');
 const router = express.Router();
 const isAuthorizedApplicationScanner = require('../middlewares/applicationScannerAuthorization')
     .isAuthorizedApplicationScanner;
 const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
 const sendItemResponse = require('../middlewares/response').sendItemResponse;
 
 // Route
 // Description: Updating profile setting.
 // Params:
 // Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
 // Returns: 200: Success, 400: Error; 500: Server Error.
 
 router.get(
     '/applicationSecurities',
     isAuthorizedApplicationScanner,
     async function(req, res) {
         try {
             const response = await ApplicationSecurityService.getSecuritiesToScan();
             return sendItemResponse(req, res, response);
         } catch (error) {
             return sendErrorResponse(req, res, error);
         }
     }
 );
 
 router.post('/scanning', isAuthorizedApplicationScanner, async function(req, res){
     try{
         const security = req.body.security;
         let applicationSecurity = await ApplicationSecurityService.updateOneBy(
             {
                 _id: security._id,
             },
             { scanning: true }
         );
        
         return sendItemResponse(req, res, applicationSecurity);
     }catch(error){
         return sendErrorResponse(req,res,error);
     }
 });
 router.post('/failed', isAuthorizedApplicationScanner, async function(req, res){
     try{
         const security = req.body;
         let applicationSecurity = await ApplicationSecurityService.updateOneBy(
             {
                 _id: security._id,
             },
             { scanning: false }
         );
         return sendItemResponse(req, res, applicationSecurity);
     }catch(error){
         return sendErrorResponse(req,res,error);
     }
 });
 router.post('/log', isAuthorizedApplicationScanner, async function(req, res){
     try{
         const security = req.body;
         const securityLog = await ApplicationSecurityLogService.create(
             {
                 securityId: security.securityId,
                 componentId: security.componentId,
                 data: security.data,
             }
         );
        
         const findLog = await ApplicationSecurityLogService.findOneBy(securityLog._id);
         
         global.io.emit(
             `securityLog_${securityLog.securityId}`,
             findLog
         );
         return sendItemResponse(req, res, securityLog);
     }catch(error){
         return sendErrorResponse(req,res,error)
     }
 });
 
 router.post('/time', isAuthorizedApplicationScanner, async function(req,res){
     try{
     const security = req.body;
     const updatedTime = await ApplicationSecurityService.updateScanTime(
         {
             _id: security._id,
         }
     );
     return sendItemResponse(req, res, updatedTime);
     }catch(error){
         return sendErrorResponse(req,res,error);
     }
     
 });
 
 
 module.exports = router;
 