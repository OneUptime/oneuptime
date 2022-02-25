import { User } from '../../config';

// Description: Will render the component is the current user in the subproject is admin.
// Params
// params 1: props
// returns JSX.Element or NULL
export default function IsMemberSubProject(subProject) {
    const userId = User.getUserId();
    if (
        userId &&
        subProject &&
        subProject.users &&
        subProject.users.length > 0 &&
        subProject.users.filter(
            user =>
                user.userId === userId &&
                (user.role !== 'Administrator' ||
                    user.role !== 'Owner' ||
                    user.role !== 'Viewer')
        ).length > 0
    ) {
        return true;
    }

    return false;
}
