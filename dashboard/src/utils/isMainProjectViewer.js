/**
 * @description checks of a user is a viewer of the main project or it's subProjects
 * @param {string} userId the id of the user
 * @param {array} subProjects the subProjects
 * @param {object} currentProject the currentProject
 */
const isMainProjectViewer = (userId, subProjects, currentProject) => {
    let user = currentProject
        ? currentProject.users.find(user => user.userId === userId)
        : null;
    if (user) {
        if (user.role === 'Viewer') return true;
        return false;
    }
    user =
        subProjects && subProjects.length > 0
            ? subProjects.map(subProject =>
                  subProject.users.find(user => user.userId === userId)
              )
            : null;
    if (user && user.length > 0) {
        const member = user.find(user => user.role !== 'Viewer');
        if (member && member._id) return false;
        return true;
    }
    return false;
};

export default isMainProjectViewer;
