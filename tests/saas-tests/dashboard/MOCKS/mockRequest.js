const mockResponse = require('./response');
module.exports = [
    {
        title: 'Signup',
        urlPattern: /user\/signup/,
        response: mockResponse.signup,
    },
    {
        title: 'Login',
        urlPattern: /user\/login/,
        response: mockResponse.login,
    },
    {
        title: 'Create Project',
        urlPattern: /project\/create/,
        response: mockResponse.createProject,
    },
    {
        title: 'isInvited',
        urlPattern: /user\/isInvited/,
        response: mockResponse.isInvited,
    },
    {
        title: 'Rename Project',
        urlPattern: /project\/([0-9]|[a-z])*\/renameProject/,
        response: mockResponse.renameProject,
    },
    {
        title: 'Get Projects',
        urlPattern: /project\/projects/,
        response: mockResponse.getProjects,
    },
    {
        title: 'Create Sub-Project',
        urlPattern: /project\/([0-9]|[a-z])*\/subProject/,
        response: mockResponse.createSubProject,
    },
    {
        title: 'Team Loading',
        urlPattern: /team\/([0-9]|[a-z])*\/teamMembers/,
        response: mockResponse.teamLoading,
    },
    {
        title: 'Team Invite',
        urlPattern: /team\/([0-9]|[a-z])*/,
        response: mockResponse.teamCreate,
    },
];
