import { User } from '../../config';

/*
 * Description: Checks if the current user in the subProject.
 * Params
 * Params 1: props
 * Returns JSX.Element or NULL
 */
export default function IsUserInSubProject(subProject: $TSFixMe): void {
    const userId: $TSFixMe = User.getUserId();
    return (
        [null, undefined].every((i: $TSFixMe) => {
            return i !== userId;
        }) &&
        [null, undefined].every((i: $TSFixMe) => {
            return i !== subProject;
        }) &&
        [null, undefined].every((i: $TSFixMe) => {
            return i !== subProject.users;
        }) &&
        subProject.users.length > 0 &&
        subProject.users.some((user: $TSFixMe) => {
            return user.userId === userId;
        })
    );
}
