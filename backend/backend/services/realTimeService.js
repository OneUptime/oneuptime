var io = global.io;

module.exports = {
    sendIncidentCreated: async (incident) => {
        try {
            var project = await ProjectService.findOneBy({ _id: incident.projectId });
            var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : incident.projectId;

            io.emit(`incidentCreated-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.sendIncidentCreated', error);
            throw error;
        }
    },

    sendMonitorCreated: async (monitor) => {
        try {
            var project = await ProjectService.findOneBy({ _id: monitor.projectId });
            var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : monitor.projectId;

            io.emit(`createMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorCreated', error);
            throw error;
        }
    },

    sendMonitorDelete: async (monitor) => {
        try {
            var project = await ProjectService.findOneBy({ _id: monitor.projectId });
            var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : monitor.projectId;

            io.emit(`deleteMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorDelete', error);
            throw error;
        }
    },

    incidentResolved: async (incident) => {
        try {
            var project = await ProjectService.findOneBy({ _id: incident.projectId });
            var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : incident.projectId;

            io.emit(`incidentResolved-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.incidentResolved', error);
            throw error;
        }
    },

    incidentAcknowledged: async (incident) => {
        try {
            var project = await ProjectService.findOneBy({ _id: incident.projectId });
            var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : incident.projectId;

            io.emit(`incidentAcknowledged-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.incidentAcknowledged', error);
            throw error;
        }
    },

    monitorEdit: async (monitor) => {
        try {
            var project = await ProjectService.findOneBy({ _id: monitor.projectId });
            var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : monitor.projectId;

            io.emit(`updateMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.monitorEdit', error);
            throw error;
        }
    },

    updateMonitorLog: async (data, monitorId, projectId) => {
        try {
            var project = await ProjectService.findOneBy({ _id: projectId });
            var parentProjectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;

            io.emit(`updateMonitorLog-${parentProjectId}`, { projectId, monitorId, data });
        } catch (error) {
            ErrorService.log('realTimeService.updateMonitorLog', error);
            throw error;
        }
    },

    updateProbe: async (data, monitorId) => {
        try {
            var monitor = await MonitorService.findOneBy({ _id: monitorId });
            var project = await ProjectService.findOneBy({ _id: monitor.projectId });
            var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;

            io.emit(`updateProbe-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.updateProbe', error);
            throw error;
        }
    },

    sendNotification: async (data) => {
        try {
            var project = await ProjectService.findOneBy({ _id: data.projectId });
            var projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : data.projectId;

            io.emit(`NewNotification-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.sendNotification', error);
            throw error;
        }
    },

    updateTeamMemberRole: async (projectId, data) => {
        try {
            var project = await ProjectService.findOneBy({ _id: projectId });

            projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;
            io.emit(`TeamMemberRoleUpdate-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.updateTeamMemberRole', error);
            throw error;
        }
    },

    createTeamMember: async (projectId, data) => {
        try {
            var project = await ProjectService.findOneBy({ _id: projectId });

            projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;
            io.emit(`TeamMemberCreate-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.createTeamMember', error);
            throw error;
        }
    },

    deleteTeamMember: async (projectId, data) => {
        try {
            var project = await ProjectService.findOneBy({ _id: projectId });

            projectId = project ? project.parentProjectId ? project.parentProjectId._id : project._id : projectId;
            io.emit(`TeamMemberDelete-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.deleteTeamMember', error);
            throw error;
        }
    },
};

var ErrorService = require('./errorService');
var ProjectService = require('./projectService');
var MonitorService = require('./monitorService');
