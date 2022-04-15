import { connect } from 'react-redux';
import { User } from '../../config';
import { RootState } from '../../store';
/*
 * Description: Will render the component is the current user in the project is admin.
 * Params
 * Params 1: props
 * Returns JSX.Element or NULL
 */

export const RenderIfAdmin: Function = (props: $TSFixMe): void => {
    const { currentProject, children }: $TSFixMe = props;
    const userId: $TSFixMe = User.getUserId();
    let renderItems: $TSFixMe = null;
    if (
        userId &&
        currentProject &&
        currentProject.users &&
        currentProject.users.length > 0 &&
        currentProject.users.filter((user: $TSFixMe) => {
            return (
                user.userId === userId &&
                (user.role === 'Administrator' || user.role === 'Owner')
            );
        }).length > 0
    ) {
        renderItems = children;
    }

    return renderItems;
};

function mapStateToProps(state: RootState): void {
    return {
        currentProject: state.project.currentProject,
    };
}

export default connect(mapStateToProps)(RenderIfAdmin);
