import { connect } from 'react-redux';
import { User } from '../../config';
import { RootState } from '../../store';
export const RenderIfViewer: Function = (props: $TSFixMe): void => {
    const { currentProject, children } = props;
    const userId = User.getUserId();
    let renderItems = null;
    if (
        userId &&
        currentProject &&
        currentProject.users &&
        currentProject.users.length > 0 &&
        currentProject.users.filter(
            (user: $TSFixMe) => user.userId === userId && user.role === 'Viewer'
        ).length > 0
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

export default connect(mapStateToProps)(RenderIfViewer);
