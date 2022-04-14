import { User } from '../../config';

// Description: Will render the component is the current user in the project is admin.
// Params
// params 1: props
// returns JSX.Element or NULL
export default function IsAdminSubProject(subProject: $TSFixMe): void {
    const userId: $TSFixMe = User.getUserId();
    return (
        [null, undefined].every(i => i !== userId) &&
        [null, undefined].every(i => i !== subProject) &&
        [null, undefined].every(i => i !== subProject.users) &&
        subProject.users.length > 0 &&
        subProject.users.some(
            (user: $TSFixMe) =>
                user.userId === userId &&
                (user.role === 'Administrator' || user.role === 'Administrator')
        )
    );
}
