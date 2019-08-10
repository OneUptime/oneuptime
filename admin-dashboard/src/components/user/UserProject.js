import React from 'react';
import UserProjectList from './UserProjectList';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { fetchUserProjects } from '../../actions/user';

class UserProject extends React.Component {
    prevClicked = () => {
        
    }
    nextClicked = () => {

    }
    render(){
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
                                <p><span>Here is a list of this user projects.</span></p>
                            </div>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                    <div>
                </div>
            </div>
            </div>
                <UserProjectList 
                    projects={this.props.projects || {}} 
                    prevClicked={this.prevClicked} 
                    nextClicked={this.nextClicked} 
                    userId={this.props.userId}
                />
                </div>
            </div>
        </div>
        )
    }
}

UserProject.displayName = 'UserProject';

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ fetchUserProjects }, dispatch)
}

const mapStateToProps = state => {
    return {
        projects: state.user.userProjects
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(UserProject);