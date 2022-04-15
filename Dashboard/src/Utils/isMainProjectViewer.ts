/**
 * @description checks of a user is a viewer of the main project or it's subProjects
 * @param {string} userId the id of the user
 * @param {array} subProjects the subProjects
 * @param {object} currentProject the currentProject
 */

import ObjectID from 'Common/Types/ObjectID';

const isMainProjectViewer: Function = (
    userId: ObjectID,
    subProjects: $TSFixMe,
    currentProject: $TSFixMe
): void => {
    let user: $TSFixMe = currentProject
        ? currentProject.users.find((user: $TSFixMe) => {
              return user.userId === userId;
          })
        : null;
    if (user) {
        if (user.role === 'Viewer') {
            return true;
        }
        return false;
    }
    user =
        subProjects && subProjects.length > 0
            ? subProjects.map((subProject: $TSFixMe) => {
                  return subProject.users.find((user: $TSFixMe) => {
                      return user.userId === userId;
                  });
              })
            : null;
    if (user && user.length > 0) {
        const member: $TSFixMe = user.find((user: $TSFixMe) => {
            return user.role !== 'Viewer';
        });
        if (member && member._id) {
            return false;
        }
        return true;
    }
    return false;
};

export default isMainProjectViewer;
