
import { User } from '../../config';

// Description: Will render the component is the current user in the project is admin.
// Params
// params 1: props
// returns JSX.Element or NULL
export default function IsAdminSubProject (subProject) {
    const userId = User.getUserId();
    return (
        [null, undefined].every(i => i !== userId) && 
        [null, undefined].every(i => i !== subProject) &&
        [null, undefined].every(i => i !== subProject.users) &&
        subProject.users.length > 0 &&
        subProject.users.some(user => user.userId === userId
            && (user.role === 'Administrator' || user.role === 'Administrator'))
    );
}