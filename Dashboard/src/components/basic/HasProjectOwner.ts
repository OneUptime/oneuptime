/*
 * Description: Will not render the component if the current project has a project owner.
 * Params
 * Params 1: project
 * Returns JSX.Element or NULL
 */

import ObjectID from 'Common/Types/ObjectID';
const HasProjectOwner: Function = (
    project: $TSFixMe,
    projectId: ObjectID,
    subProjects: $TSFixMe
): void => {
    if (project._id === projectId) {
        return (
            project &&
            project.users &&
            project.users.length > 0 &&
            project.users.some((user: $TSFixMe) => {
                return user.role === 'Owner';
            })
        );
    }

    return subProjects && subProjects.length > 0
        ? subProjects.some((subProject: $TSFixMe) => {
              return (
                  subProject._id === projectId &&
                  subProject.users.some((user: $TSFixMe) => {
                      return user.role === 'Owner';
                  })
              );
          })
        : false;
};

export default HasProjectOwner;
