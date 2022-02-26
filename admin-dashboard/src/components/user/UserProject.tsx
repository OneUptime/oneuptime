import React from 'react';
import PropTypes from 'prop-types';
import ProjectList from '../project/ProjectList';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { fetchUserProjects } from '../../actions/project';

class UserProject extends React.Component {
    constructor() {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1-2 arguments, but got 0.
        super();
        this.state = { page: 1 };
    }
    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { userId } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserProjects' does not exist on typ... Remove this comment to see the full error message
        this.props.fetchUserProjects(
            userId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { userId } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserProjects' does not exist on typ... Remove this comment to see the full error message
        this.props.fetchUserProjects(userId, skip + limit, 10);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };
    render() {
        return (
            <div className="bs-BIM">
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
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projects: any; prevClicked: (skip: any, li... Remove this comment to see the full error message
                            projects={this.props.projects || {}}
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
                            userId={this.props.userId}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            page={this.state.page}
                        />
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
UserProject.displayName = 'UserProject';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ fetchUserProjects }, dispatch);
};

const mapStateToProps = (state: $TSFixMe) => {
    const userId = state.user.user.user ? state.user.user.user._id : null;

    return {
        userId,
        projects: state.project.userProjects,
    };
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
UserProject.propTypes = {
    fetchUserProjects: PropTypes.func.isRequired,
    userId: PropTypes.string,
    projects: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(UserProject);
