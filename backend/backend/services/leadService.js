/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    //Description: Create new project for user.
    //Params:
    //Param 1: projectName: Project name.
    //Param 2: projectId: Project Id present in req.params.
    //Param 3: userId: User Id.
    //Returns: promise
    create: async function(data) {
        try {
            let lead = new LeadsModel();
            lead.type = data.type;
            lead.name = data.name;
            lead.email = data.email;
            lead.phone = data.phone;
            lead.website = data.website;
            lead.companySize = data.companySize;
            lead.country = data.country;
            lead.message = data.message;
            lead.whitepaperName = data.whitepaperName;

            lead = await lead.save();
            MailService.sendLeadEmailToFyipeTeam(lead);
            if (data.type) {
                if (data.type === 'demo') {
                    await MailService.sendRequestDemoEmail(data.email);
                }

                if (data.type === 'whitepaper') {
                    await MailService.sendWhitepaperEmail(
                        data.email,
                        data.whitepaperName
                    ); //whitepaper name should be stored in moreInfo.
                }
            }
            return lead;
        } catch (error) {
            ErrorService.log('leadService.create', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await LeadsModel.deleteMany(query);
            return 'Lead(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('leadService.hardDeleteBy', error);
            throw error;
        }
    },
};

const LeadsModel = require('../models/lead');
const MailService = require('./mailService');
const ErrorService = require('./errorService');
