import { Mutex } from 'async-mutex';
import mongoose from 'mongoose';

import MUTEX_RESOURCES from './MUTEX_RESOURCES';

// this is a single mutex storage
// it contains one mutex per project
const projectMutexStorage = new Map();

// thi is a single mutex storage
// it contains one mutex per monitor
const monitorMutexStorage = new Map();

/**
 * gets an existing mutex for a project or creates a new one
 * @param {string} mutexResource the resource category to lock
 * @param {*} id unique id of the resource to lock
 * @return {*} a mutex for the project
 */
const getMutex = (mutexResource: $TSFixMe, resourceId: $TSFixMe) => {
    let mutex;
    let mutexStorage;
    try {
        if (!mongoose.isValidObjectId(resourceId)) {
            return;
        }

        switch (mutexResource) {
            case MUTEX_RESOURCES.PROJECT:
                mutex = projectMutexStorage.get(resourceId);
                mutexStorage = projectMutexStorage;
                break;
            case MUTEX_RESOURCES.MONITOR:
                mutex = monitorMutexStorage.get(resourceId);
                mutexStorage = monitorMutexStorage;
                break;
            default:
                return;
        }
        if (!mutex) {
            mutex = new Mutex();
            mutexStorage.set(resourceId, mutex);
        }

        return mutex;
    } catch (error) {
        return mutex;
    }
};

export default getMutex;
