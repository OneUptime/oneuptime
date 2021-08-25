import { connect } from 'react-redux';
import { User } from '../../config';

// Description: Will render the component is the current user in the project is member.
// Params
// params 1: props
// returns JSX.Element or NULL
function RenderIfMember(props) {
    const { currentProject, children, userId } = props;
    let renderItems = null;
    if (
        userId &&
        currentProject &&
        currentProject.users &&
        currentProject.users.length > 0 &&
        currentProject.users.filter(
            user =>
                user.userId === userId &&
                user.role !== 'Administrator' &&
                user.role !== 'Owner' &&
                user.role !== 'Viewer'
        ).length > 0
    ) {
        renderItems = children;
    }

    return renderItems;
}

RenderIfMember.defaultProps = {
    userId: User.getUserId(),
};

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
    };
}

export default connect(mapStateToProps)(RenderIfMember);
