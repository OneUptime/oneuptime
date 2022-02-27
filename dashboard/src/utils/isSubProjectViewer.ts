/**
 * @description checks of a user is a viewer of the subProject or subsubProject
 * @param {string} userId the id of the user
 * @param {object} subProject the subProject
 */

const isSubProjectViewer = (userId: $TSFixMe, subProject: $TSFixMe) => {
    const user = subProject
        ? subProject.users.find(
              (user: $TSFixMe) =>
                  user.userId === userId && user.role === 'Viewer'
          )
        : null;
    if (user) return true;
    return false;
};

export default isSubProjectViewer;
