// Description: Will not render the component if the current project has a project owner.
// Params
// params 1: project
// returns JSX.Element or NULL
const HasProjectOwner = (project, projectId, subProjects) => {
    if (project._id === projectId) {
        return (
            project &&
            project.users &&
            project.users.length > 0 &&
            project.users.some(user => user.role === 'Owner')
        );
    }

    return subProjects && subProjects.length > 0
        ? subProjects.some(
              subProject =>
                  subProject._id === projectId &&
                  subProject.users.some(user => user.role === 'Owner')
          )
        : false;
};

export default HasProjectOwner;
