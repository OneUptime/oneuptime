module.exports = {
    sendCreatedIncident: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`incidentCreated-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.sendCreatedIncident', error);
            throw error;
        }
    },

    updateIncidentNote: async incident => {
        try {
            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`updateIncidentNote-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.updateIncidentNote', error);
            throw error;
        }
    },

    addScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                _id: event.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : event.projectId;

            global.io.emit(`addScheduledEvent-${projectId}`, event);
        } catch (error) {
            ErrorService.log('realTimeService.addScheduledEvent', error);
            throw error;
        }
    },

    updateScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                _id: event.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : event.projectId;

            global.io.emit(`updateScheduledEvent-${projectId}`, event);
        } catch (error) {
            ErrorService.log('realTimeService.updateScheduledEvent', error);
            throw error;
        }
    },

    sendComponentCreated: async component => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: component.projectId._id,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : component.projectId._id;

            global.io.emit(`createComponent-${projectId}`, component);
        } catch (error) {
            ErrorService.log('realTimeService.sendComponentCreated', error);
            throw error;
        }
    },

    sendMonitorCreated: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: monitor.projectId._id,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : monitor.projectId._id;

            global.io.emit(`createMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorCreated', error);
            throw error;
        }
    },

    sendComponentDelete: async component => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: component.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : component.projectId;

            global.io.emit(`deleteComponent-${projectId}`, component);
        } catch (error) {
            ErrorService.log('realTimeService.sendComponentDelete', error);
            throw error;
        }
    },

    sendMonitorDelete: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: monitor.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : monitor.projectId;

            global.io.emit(`deleteMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorDelete', error);
            throw error;
        }
    },

    incidentResolved: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`incidentResolved-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.incidentResolved', error);
            throw error;
        }
    },

    incidentAcknowledged: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`incidentAcknowledged-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.incidentAcknowledged', error);
            throw error;
        }
    },

    statusPageEdit: async statusPage => {
        try {
            const project = await ProjectService.findOneBy({
                _id: statusPage.projectId._id,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : statusPage.projectId._id;

            global.io.emit(`updateStatusPage-${projectId}`, statusPage);
        } catch (error) {
            ErrorService.log('realTimeService.statusPageEdit', error);
            throw error;
        }
    },

    componentEdit: async component => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: component.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : component.projectId;

            global.io.emit(`updateComponent-${projectId}`, component);
        } catch (error) {
            ErrorService.log('realTimeService.componentEdit', error);
            throw error;
        }
    },

    monitorEdit: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: monitor.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : monitor.projectId;

            global.io.emit(`updateMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.monitorEdit', error);
            throw error;
        }
    },

    updateMonitorLog: async (data, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;

            global.io.emit(`updateMonitorLog-${parentProjectId}`, {
                projectId,
                monitorId: data.monitorId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateMonitorLog', error);
            throw error;
        }
    },

    updateMonitorStatus: async (data, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;

            global.io.emit(`updateMonitorStatus-${parentProjectId}`, {
                projectId,
                monitorId: data.monitorId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateMonitorStatus', error);
            throw error;
        }
    },

    updateProbe: async (data, monitorId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const monitor = await MonitorService.findOneBy({ _id: monitorId });

            if (!monitor) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: monitor.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : monitor.projectId;

            global.io.emit(`updateProbe-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.updateProbe', error);
            throw error;
        }
    },

    sendNotification: async data => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: data.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : data.projectId;

            global.io.emit(`NewNotification-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.sendNotification', error);
            throw error;
        }
    },

    updateTeamMemberRole: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });

            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;
            global.io.emit(`TeamMemberRoleUpdate-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.updateTeamMemberRole', error);
            throw error;
        }
    },

    createTeamMember: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });

            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;
            global.io.emit(`TeamMemberCreate-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.createTeamMember', error);
            throw error;
        }
    },

    deleteTeamMember: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });

            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;
            global.io.emit(`TeamMemberDelete-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.deleteTeamMember', error);
            throw error;
        }
    },

    sendApplicationLogCreated: async applicationLog => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId = applicationLog.componentId._id;

            global.io.emit(`createApplicationLog-${componentId}`, applicationLog);
        } catch (error) {
            ErrorService.log('realTimeService.sendApplicationLogCreated', error);
            throw error;
        }
    },
    sendApplicationLogDelete: async applicationLog => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId = applicationLog.componentId._id;

            global.io.emit(`deleteApplicationLog-${componentId}`, applicationLog);
        } catch (error) {
            ErrorService.log('realTimeService.sendApplicationLogDelete', error);
            throw error;
        }
    },
    sendLogCreated: async contentLog => {
        try {
            if (!global || !global.io) {
                return;
            }
            const applicationLogId = contentLog.applicationLogId._id;

            global.io.emit(`createLog-${applicationLogId}`, contentLog);
        } catch (error) {
            ErrorService.log('realTimeService.sendLogCreated', error);
            throw error;
        }
    },
};

const ErrorService = require('./errorService');
const ProjectService = require('./projectService');
const MonitorService = require('./monitorService');
