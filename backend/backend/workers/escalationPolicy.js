const ErrorService = require('../services/errorService');
const OnCallScheduleStatusService = require('../services/onCallScheduleStatusService');
const AlertService = require('../services/alertService');
const DateTime = require('../utils/DateTime');

module.exports = {

    checkActiveEscalationPolicyAndSendAlerts: async () => {
        try {

            /* 

            #1 - Get all the OnCallScheduleStatus where incidentAcknowledged is false. 
            #2 - Check if incident attached to those schedule is actually NOT ack. If ack, mark this OnCallScheduleStatus.incidentAcknowledged = true and skip; 
            #3 - If incident is not ack, then continue steps below. 
            #4 - Query Alert collection, and get all the alerts attached to that OnCallScheduleStatus
            #5 - Get EscalationPolicy related to OnCallScheduleStatus. 
            #6 - Check if proper alerts are sent. 
            #7 - if proper alert reminders are exhaused, then escalate this incident and alert next set of team members. 
            
            */

            //#1

            var notAcknowledgedCallScheduleStatuses = await OnCallScheduleStatusService.findBy({ query: { incidentAcknowledged: false }, limit: 9999999, skip: 0 });

            for(var notAcknowledgedCallScheduleStatus of notAcknowledgedCallScheduleStatuses){

                if(!notAcknowledgedCallScheduleStatus){
                    continue; 
                }

                // #2
                if(!notAcknowledgedCallScheduleStatus.incident){
                    notAcknowledgedCallScheduleStatus.incidentAcknowledged = true; 
                    notAcknowledgedCallScheduleStatus.save();
                    continue; 
                }

                if(notAcknowledgedCallScheduleStatus.incident && notAcknowledgedCallScheduleStatus.incident.acknowledged){
                    notAcknowledgedCallScheduleStatus.incidentAcknowledged = true; 
                    notAcknowledgedCallScheduleStatus.save();
                    continue; 
                }

                // #3 and #4
                // get active escalation policy. 
                
                var alerts = await AlertService.findBy({query: {onCallScheduleStatus:notAcknowledgedCallScheduleStatus.id}, limit: 9999, skip: 0, sort: {createdAt:-1}}); //sort by createdAtdescending. 
                if(alerts && alerts.length > 0 && alerts[0]){
                    //check when the last alert was sent.  
                    var lastAlertSentAt = alerts[0].createdAt; //we take '0' index because list is reverse sorted. 
                    if(DateTime.isInLastMinute(lastAlertSentAt)){
                        continue; 
                    }
                }

                //and the rest happens here. 
                AlertService.sendAlertsToTeamMembersInSchedule({schedule: notAcknowledgedCallScheduleStatus.schedule, incident:notAcknowledgedCallScheduleStatus.incident });                
            }

        } catch (error) {
            ErrorService.log('escalationPolicyCron.checkActiveEscalationPolicyAndSendAlerts', error);
            throw error;
        }
    }
};


