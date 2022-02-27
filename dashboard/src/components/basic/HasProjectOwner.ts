// Description: Will not render the component if the current project has a project owner.
// Params
// params 1: project
// returns JSX.Element or NULL
const HasProjectOwner = (
    project: $TSFixMe,
    projectId: $TSFixMe,
    subProjects: $TSFixMe
) => {
    if (project._id === projectId) {
        return (
            project &&
            project.users &&
            project.users.length > 0 &&
            project.users.some((user: $TSFixMe) => user.role === 'Owner')
        );
    }

    return subProjects && subProjects.length > 0
        ? subProjects.some(
              (subProject: $TSFixMe) =>
                  subProject._id === projectId &&
                  subProject.users.some(
                      (user: $TSFixMe) => user.role === 'Owner'
                  )
          )
        : false;
};

export default HasProjectOwner;
