import React from 'react';
import PropTypes from 'prop-types';
import ProjectList from '../project/ProjectList';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { fetchUserProjects } from '../../actions/project';

class UserProject extends Component<ComponentProps> {
    constructor() {

        super();
        this.state = { page: 1 };
    }
    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {

        const { userId } = this.props;

        this.props.fetchUserProjects(
            userId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );

        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {

        const { userId } = this.props;

        this.props.fetchUserProjects(userId, skip + limit, 10);

        this.setState({ page: this.state.page + 1 });
    };
    override render() {
        return (
            <div className="bs-BIM" >
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Project Details</span>
                                    </span>
                                    <p>
                                        <span>
                                            Here is a list of all the projects
                                            which belongs to this user.
                                        </span>
                                    </p>
                                </div>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div></div>
                            </div>
                        </div>
                        <ProjectList

                            projects={this.props.projects || {}}
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}

                            userId={this.props.userId}

                            page={this.state.page}
                        />
                    </div>
                </div>
            </div>
        );
    }
}


UserProject.displayName = 'UserProject';

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({ fetchUserProjects }, dispatch);
};

const mapStateToProps = (state: RootState) => {
    const userId = state.user.user.user ? state.user.user.user._id : null;

    return {
        userId,
        projects: state.project.userProjects,
    };
};

UserProject.propTypes = {
    fetchUserProjects: PropTypes.func.isRequired,
    userId: PropTypes.string,
    projects: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(UserProject);
