import { connect } from 'react-redux';
import { User } from '../../config';

// Description: Will render the component is the current user in the project is admin.
// Params
// params 1: props
// returns JSX.Element or NULL
export function RenderIfOwner(props) {
    const {currentProject, children} = props;
    var userId = User.getUserId();
    var renderItems = null;
    if (
        userId && currentProject &&
        currentProject.users &&
        currentProject.users.length > 0 &&
        currentProject.users.filter(user => user.userId === userId && user.role === 'Owner').length > 0
    ) {
        renderItems = children
    }

    return renderItems;
}

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject
    };
}

export default connect(mapStateToProps)(RenderIfOwner);