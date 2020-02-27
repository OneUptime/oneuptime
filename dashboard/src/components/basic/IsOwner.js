import { User } from '../../config';

// Description: Will render the component is the current user in the project is admin.
// Params
// params 1: props
// returns JSX.Element or NULL
export default function IsOwner(currentProject) {
    const userId = User.getUserId();
    return (
        [null, undefined].every(i => i !== userId) &&
        [null, undefined].every(i => i !== currentProject) &&
        [null, undefined].every(i => i !== currentProject.users) &&
        currentProject.users.length > 0 &&
        currentProject.users.some(
            user => user.userId === userId && user.role === 'Owner'
        )
    );
}
