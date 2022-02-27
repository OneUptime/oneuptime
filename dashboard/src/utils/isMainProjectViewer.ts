/**
 * @description checks of a user is a viewer of the main project or it's subProjects
 * @param {string} userId the id of the user
 * @param {array} subProjects the subProjects
 * @param {object} currentProject the currentProject
 */
const isMainProjectViewer = (
    userId: $TSFixMe,
    subProjects: $TSFixMe,
    currentProject: $TSFixMe
) => {
    let user = currentProject
        ? currentProject.users.find((user: $TSFixMe) => user.userId === userId)
        : null;
    if (user) {
        if (user.role === 'Viewer') return true;
        return false;
    }
    user =
        subProjects && subProjects.length > 0
            ? subProjects.map((subProject: $TSFixMe) =>
                  subProject.users.find(
                      (user: $TSFixMe) => user.userId === userId
                  )
              )
            : null;
    if (user && user.length > 0) {
        const member = user.find((user: $TSFixMe) => user.role !== 'Viewer');
        if (member && member._id) return false;
        return true;
    }
    return false;
};

export default isMainProjectViewer;
