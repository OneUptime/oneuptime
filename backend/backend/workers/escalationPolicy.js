const ErrorService = require('../services/errorService');
const OnCallScheduleStatusService = require('../services/onCallScheduleStatusService');
const AlertService = require('../services/alertService');
const EscalationService = require('../services/escalationService');
const DateTime = require('../utils/DateTime');
const moment = require('moment');

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
                    var lastAlertSent = alerts[0].createdAt; //we take '0' index because list is reverse sorted. 
                    if(DateTime.isInLastMinute(lastAlertSent)){
                        continue; 
                    }
                }


                // this case is not possible, but still...
                if(!notAcknowledgedCallScheduleStatus.escalations && notAcknowledgedCallScheduleStatus.escalations.length === 0){
                    var notAcknowledgedCallScheduleStatusEscalation = {
                        escalation: notAcknowledgedCallScheduleStatus.activeEscalation,
                        callRemindersSent: 0,
                        smsRemindersSent: 0,
                        emailRemindersSent: 0
                    }
                }

                //last alert sent is > minute. then, check if this escalation policy has exhaused any alerts. 
                notAcknowledgedCallScheduleStatusEscalation = notAcknowledgedCallScheduleStatus.escalations[notAcknowledgedCallScheduleStatus.escalations.length - 1];

                var shouldSendSMSReminder = false; 
                var shouldSendCallReminder = false;
                var shouldSendEmailReminder = false;

                var escalationPolicy = await EscalationService.findOneBy({_id: notAcknowledgedCallScheduleStatusEscalation.escalation})
                
                if(escalationPolicy){
                    shouldSendSMSReminder = escalationPolicy.smsReminders > notAcknowledgedCallScheduleStatusEscalation.smsRemindersSent;
                    shouldSendCallReminder = escalationPolicy.callReminders > notAcknowledgedCallScheduleStatusEscalation.callRemindersSent;
                    shouldSendEmailReminder = escalationPolicy.emailReminders > notAcknowledgedCallScheduleStatusEscalation.emailRemindersSent;

                    if(shouldSendCallReminder){
                        AlertService.sendCallAlert();
                    } 

                    if(shouldSendEmailReminder){
                        AlertService.sendEmailAlert();
                    } 

                    if(shouldSendSMSReminder){
                        AlertService.sendSMSAlert();
                    } 
                    
                    //if all the alerts are exhaused, then escalate.
                    if(!shouldSendSMSReminder && !shouldSendEmailReminder && !shouldSendCallReminder){
                        _escalate();
                    }

                }else{
                    _escalate();
                }
            }

        } catch (error) {
            ErrorService.log('escalationPolicyCron.checkActiveEscalationPolicyAndSendAlerts', error);
            throw error;
        }
    }
};

async function _escalate({}){

}

