export default {
    //Description: Create new project for user.
    //Params:
    //Param 1: projectName: Project name.
    //Param 2: projectId: Project Id present in req.params.
    //Param 3: userId: User Id.
    //Returns: promise
    create: async function(data: $TSFixMe) {
        let lead = new LeadsModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Document<a... Remove this comment to see the full error message
        lead.type = data.type;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
        lead.name = data.name;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Document<... Remove this comment to see the full error message
        lead.email = data.email;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'phone' does not exist on type 'Document<... Remove this comment to see the full error message
        lead.phone = data.phone;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'website' does not exist on type 'Documen... Remove this comment to see the full error message
        lead.website = data.website;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companySize' does not exist on type 'Doc... Remove this comment to see the full error message
        lead.companySize = data.companySize;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'country' does not exist on type 'Documen... Remove this comment to see the full error message
        lead.country = data.country;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type 'Documen... Remove this comment to see the full error message
        lead.message = data.message;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'whitepaperName' does not exist on type '... Remove this comment to see the full error message
        lead.whitepaperName = data.whitepaperName;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'source' does not exist on type 'Document... Remove this comment to see the full error message
        lead.source = data.source;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'templateName' does not exist on type 'Do... Remove this comment to see the full error message
        lead.templateName = 'Request Demo';
        if (data.whitepaperName) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'templateName' does not exist on type 'Do... Remove this comment to see the full error message
            lead.templateName = 'Whitepaper Request';
        }

        lead = await lead.save();
        try {
            MailService.sendLeadEmailToOneUptimeTeam(lead);
            if (data.type) {
                if (data.type === 'demo') {
                    MailService.sendRequestDemoEmail(data.email);
                }

                if (data.type === 'whitepaper') {
                    MailService.sendWhitepaperEmail(
                        data.email,
                        data.whitepaperName
                    ); //whitepaper name should be stored in moreInfo.
                }
            }
        } catch (error) {
            ErrorService.log('leadService.create', error);
        }
        AirtableService.logLeads({
            name: data.name,
            email: data.email,
            phone: data.phone,
            country: data.country,
            message: data.message,
            website: data.website,
            source: data.source,
            volume: data.companySize,
            type: data.type,
        });
        return lead;
    },

    hardDeleteBy: async function(query: $TSFixMe) {
        await LeadsModel.deleteMany(query);
        return 'Lead(s) Removed Successfully!';
    },
};

import LeadsModel from '../models/lead';
import MailService from './mailService';
import ErrorService from 'common-server/utils/error';
import AirtableService from './airtableService';
