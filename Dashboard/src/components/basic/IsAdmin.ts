import { User } from '../../config';

// Description: Will render the component is the current user in the project is admin.
// Params
// params 1: props
// returns JSX.Element or NULL
export default function IsAdmin(currentProject: $TSFixMe): void {
    const userId: $TSFixMe = User.getUserId();
    return (
        [null, undefined].every((i: $TSFixMe) => {
            return i !== userId;
        }) &&
        [null, undefined].every((i: $TSFixMe) => {
            return i !== currentProject;
        }) &&
        [null, undefined].every((i: $TSFixMe) => {
            return i !== currentProject.users;
        }) &&
        currentProject.users.length > 0 &&
        currentProject.users.some((user: $TSFixMe) => {
            return (
                user.userId === userId &&
                (user.role === 'Administrator' || user.role === 'Administrator')
            );
        })
    );
}
