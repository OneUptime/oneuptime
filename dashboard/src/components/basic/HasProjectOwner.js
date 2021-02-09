// Description: Will not render the component if the current project has a project owner.
// Params
// params 1: project
// returns JSX.Element or NULL
const HasProjectOwner = project => {
    return (
        project &&
        project.users &&
        project.users.length > 0 &&
        project.users.some(user => user.role === 'Owner')
    );
};

export default HasProjectOwner;
