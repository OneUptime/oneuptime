import { connect } from 'react-redux';
import { User } from '../../config';
import { RootState } from '../../store';
// Description: Will render the component is the current user in the project is member.
// Params
// params 1: props
// returns JSX.Element or NULL
function RenderIfSubProjectMember(props: $TSFixMe): void {
    const { currentProject, subProjects, children, currentUserId }: $TSFixMe =
        props;
    const userId: $TSFixMe = User.getUserId();

    let renderItems: $TSFixMe = null;
    if (
        userId &&
        userId === currentUserId &&
        currentProject &&
        currentProject.users &&
        currentProject.users.length > 0 &&
        currentProject.users.filter(
            (user: $TSFixMe) =>
                user.userId === userId &&
                user.role !== 'Administrator' &&
                user.role !== 'Owner' &&
                user.role !== 'Viewer'
        ).length > 0
    ) {
        renderItems = children;
    } else {
        if (subProjects) {
            subProjects.forEach((subProject: $TSFixMe) => {
                if (
                    userId &&
                    userId === currentUserId &&
                    subProject &&
                    subProject.users &&
                    subProject.users.length > 0 &&
                    subProject.users.filter(
                        (user: $TSFixMe) =>
                            user.userId === userId &&
                            user.role !== 'Administrator' &&
                            user.role !== 'Owner' &&
                            user.role !== 'Viewer'
                    ).length > 0
                ) {
                    renderItems = children;
                }
            });
        }
    }
    return renderItems;
}

function mapStateToProps(state: RootState): void {
    return {
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
    };
}

export default connect(mapStateToProps)(RenderIfSubProjectMember);
