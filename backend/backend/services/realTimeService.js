var CB = require('cloudboost');

CB.CloudApp.init('hcaarmonukbk', 'cc7427bc-ca50-450e-a8a4-d2fc42155847');

module.exports = {
    sendIncidentCreated: async (incident) => {
        try {
            var project = await ProjectService.findOneBy({ _id: incident.projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : incident.projectId;
        try {
            CB.CloudNotification.publish(`incidentCreated-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`incidentCreated`)', error);
            throw error;
        }
    },

    sendMonitorCreated: async (monitor) => {
        try {
            var project = await ProjectService.findOneBy({ _id: monitor.projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : monitor.projectId;
        try {
            CB.CloudNotification.publish(`createMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`createMonitor`)', error);
            throw error;
        }
    },

    sendMonitorDelete: async (monitor) => {
        try {
            var project = await ProjectService.findOneBy({ _id: monitor.projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : monitor.projectId;
        try {
            CB.CloudNotification.publish(`deleteMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`deleteMonitor`)', error);
            throw error;
        }
    },

    incidentResolved: async (incident) => {
        try {
            var project = await ProjectService.findOneBy({ _id: incident.projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : incident.projectId;
        try {
            CB.CloudNotification.publish(`incidentResolved-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`incidentResolved`)', error);
            throw error;
        }
    },

    incidentAcknowledged: async (incident) => {
        try {
            var project = await ProjectService.findOneBy({ _id: incident.projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : incident.projectId;
        try {
            CB.CloudNotification.publish(`incidentAcknowledged-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`incidentAcknowledged`)', error);
            throw error;
        }
    },

    monitorEdit: async (monitor) => {
        try {
            var project = await ProjectService.findOneBy({ _id: monitor.projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : monitor.projectId;
        try {
            CB.CloudNotification.publish(`updateMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`updateMonitor`)', error);
            throw error;
        }
    },

    updateResponseTime: async (data, projectId) => {
        try {
            var project = await ProjectService.findOneBy({ _id: projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;
        try {
            CB.CloudNotification.publish(`updateResponseTime-${projectId}`, data);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`updateResponseTime`)', error);
            throw error;
        }
    },

    updateMonitorLog: async (data, monitorId, projectId) => {
        try {
            var project = await ProjectService.findOneBy({ _id: projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;
        try {
            CB.CloudNotification.publish(`updateMonitorLog-${projectId}`, { projectId, monitorId, data });
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`updateMonitorLog`)', error);
            throw error;
        }
    },

    updateProbe: async (data, monitorId) => {
        try {
            var monitor = await MonitorService.findOneBy({ _id: monitorId });
        } catch (error) {
            ErrorService.log('MonitorService.findOneBy', error);
            throw error;
        }
        try {
            var project = await ProjectService.findOneBy({ _id: monitor.projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;
        try {
            CB.CloudNotification.publish(`updateProbe-${projectId}`, data);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`updateProbe`)', error);
            throw error;
        }
    },

    sendNotification: async (data) => {
        try {
            var project = await ProjectService.findOneBy({ _id: data.projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : data.projectId;
        try {
            CB.CloudNotification.publish(`NewNotification-${projectId}`, data);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`NewNotification`)', error);
            throw error;
        }
    },

    updateTeamMemberRole: async (projectId, data) => {
        try {
            var project = await ProjectService.findOneBy({ _id: projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;
        try {
            CB.CloudNotification.publish(`TeamMemberRoleUpdate-${projectId}`, data);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`TeamMemberRoleUpdate`)', error);
            throw error;
        }
    },

    createTeamMember: async (projectId, data) => {
        try {
            var project = await ProjectService.findOneBy({ _id: projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;
        try {
            CB.CloudNotification.publish(`TeamMemberCreate-${projectId}`, data);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`TeamMemberCreate`)', error);
            throw error;
        }
    },

    deleteTeamMember: async (projectId, data) => {
        try {
            var project = await ProjectService.findOneBy({ _id: projectId });
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;
        try {
            CB.CloudNotification.publish(`TeamMemberDelete-${projectId}`, data);
        } catch (error) {
            ErrorService.log('CB.CloudNotification.publish(`TeamMemberDelete`)', error);
            throw error;
        }
    },
};

var ErrorService = require('./errorService');
var ProjectService = require('./projectService');
var MonitorService = require('./monitorService');