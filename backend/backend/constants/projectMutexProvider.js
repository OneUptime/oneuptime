const { Mutex } = require('async-mutex');
const mongoose = require('mongoose');
const errorService = require('../services/errorService');

// this is a single mutex storage
// it contains one mutex per project
const projectMutexStorage = new Map();

/**
 * gets an existing mutex for a project or creates a new one
 *
 * @param {*} projectId id of the project to use as a key
 * @return {*} a mutex for the project
 */
const getProjectMutex = projectId => {
    let projectMutex;
    try {
        if (mongoose.isValidObjectId(projectId)) {
            projectMutex = projectMutexStorage.get(projectId);
            if (!projectMutex) {
                projectMutex = new Mutex();
                projectMutexStorage.set(projectId, projectMutex);
            }
        }
        return projectMutex;
    } catch (error) {
        errorService.log('ProjectMutexProvider.getProjectMutex', error);
        return projectMutex;
    }
};

module.exports = getProjectMutex;
