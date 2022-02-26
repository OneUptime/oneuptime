/**
 * @description checks of a user is the owner or admin of a project
 * @param {string} userId the id of the user
 * @param {object} project the project
 */

const isOwnerOrAdmin = (userId: $TSFixMe, project: $TSFixMe) => {
    const currentUser =
        project &&
        project.users.filter((user: $TSFixMe) => String(user.userId) === String(userId));

    return currentUser &&
        currentUser.length > 0 &&
        currentUser[0] &&
        currentUser[0].role &&
        (currentUser[0].role === 'Owner' ||
            currentUser[0].role === 'Administrator')
        ? true
        : false;
};

export default isOwnerOrAdmin;
