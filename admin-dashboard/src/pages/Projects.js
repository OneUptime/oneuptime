import React from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ProjectList from '../components/project/ProjectList';
import { fetchProjects, searchProjects } from '../actions/project';
import Dashboard from '../components/Dashboard';

class Projects extends React.Component {

    constructor(props){
        super(props);

        this.state = {
            searchBox: null
        }
    }

    prevClicked = (skip, limit) => {
        const { searchBox } = this.state;
        const { fetchProjects, searchProjects } = this.props;

        if(searchBox && searchBox !== ''){
            searchProjects(searchBox, (skip || 0) > (limit || 10) ? skip - limit : 0, 10);
        }else{
            fetchProjects((skip || 0) > (limit || 10) ? skip - limit : 0, 10);
        }
    }

    nextClicked = (skip, limit) => {
        const { searchBox } = this.state;
        const { fetchProjects, searchProjects } = this.props;

        if(searchBox && searchBox !== ''){
            searchProjects(searchBox, skip + limit, 10);
        }else{
            fetchProjects(skip + limit, 10);
        }
    }
    ready = () => {
        this.props.fetchProjects();
    }

    onChange = (e) => {
        const value = e.target.value;
        const { searchProjects } = this.props;

        this.setState({ searchBox: value });
        searchProjects(value, 0, 10);
    }

    render(){
        console.log('requesting: ', this.props.requesting);
        return (
            <Dashboard ready={this.ready}>
                <div onKeyDown={this.handleKeyBoard} className="db-World-contentPane Box-root Padding-bottom--48">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div
                                    className="customers-list-view react-view popover-container"
                                    style={{ position: 'relative', overflow: 'visible' }}
                                ></div>
                                <div className="bs-BIM">
                                    <div className="Box-root Margin-bottom--12">
                                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                        <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                            <span style={{'textTransform':'capitalize'}}>Fyipe Projects</span>
                                                            </span>
                                                            <span style={{'textTransform':'lowercase'}} className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>Here is a list of all fyipe projects</span>
                                                            </span>
                                                        </div>
                                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div className="Box-root">
                                                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                    <div>
                                                                        <input 
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            placeholder="search project's name"
                                                                            onChange={this.onChange}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                        <div>
                                    </div>
                                </div>
                                </div>
                                    <ProjectList 
                                        projects={this.props.projects || {}} 
                                        prevClicked={this.prevClicked} 
                                        nextClicked={this.nextClicked} 
                                        userId={this.props.userId}
                                        requesting={this.props.requesting}
                                    />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Dashboard>
        )
    }
}

Projects.displayName = 'Projects';

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ fetchProjects, searchProjects }, dispatch)
}

const mapStateToProps = state => {
    const projects = state.project.projects;
    const searchProjects = state.project.searchProjects;
    const requesting = projects && searchProjects ? projects.requesting || searchProjects.requesting ? true : false : false;
    
    return {
        projects,
        requesting
    };
}

Projects.propTypes = {
    fetchProjects: PropTypes.func.isRequired,
    searchProjects: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    projects: PropTypes.object,
    userId: PropTypes.string
}

export default connect(mapStateToProps, mapDispatchToProps)(Projects);