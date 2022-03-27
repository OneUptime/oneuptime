import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import ProjectList from '../components/project/ProjectList';
import { fetchProjects, searchProjects } from '../actions/project';

import * as _ from 'lodash';
class Projects extends Component<ComponentProps> {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);

        this.state = {
            searchBox: null,
            page: 1,
        };
    }

    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {

        const { searchBox } = this.state;

        const { fetchProjects, searchProjects } = this.props;

        if (searchBox && searchBox !== '') {
            searchProjects(
                searchBox,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            fetchProjects((skip || 0) > (limit || 10) ? skip - limit : 0, 10);
        }

        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {

        const { searchBox } = this.state;

        const { fetchProjects, searchProjects } = this.props;

        if (searchBox && searchBox !== '') {
            searchProjects(searchBox, skip + limit, 10);
        } else {
            fetchProjects(skip + limit, 10);
        }

        this.setState({ page: this.state.page + 1 });
    };

    componentDidMount = () => {

        this.props.fetchProjects();
    };

    onChange = (e: $TSFixMe) => {
        const value = e.target.value;

        const { searchProjects } = this.props;

        this.setState({ searchBox: value });
        searchProjects(value, 0, 10);
        this.setState({ page: 1 });
    };

    override render() {
        return (
            <div
                id="oneuptimeProject"
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-vertical--12"
            >
                <div>
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div
                                className="customers-list-view react-view popover-container"
                                style={{
                                    position: 'relative',
                                    overflow: 'visible',
                                }}
                            ></div>
                            <div className="bs-BIM">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                            <span
                                                                style={{
                                                                    textTransform:
                                                                        'capitalize',
                                                                }}
                                                            >
                                                                OneUptime
                                                                Projects
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Here is a list
                                                                of all the
                                                                projects on
                                                                OneUptime.
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                        <div className="Box-root">
                                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                <div>
                                                                    <input
                                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                        placeholder="Search Projects"
                                                                        onChange={_.debounce(
                                                                            this
                                                                                .onChange,
                                                                            500
                                                                        )}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
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

                                            requesting={this.props.requesting}

                                            page={this.state.page}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


Projects.displayName = 'Projects';

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({ fetchProjects, searchProjects }, dispatch);
};

const mapStateToProps = (state: RootState) => {
    const projects = state.project.projects;
    const searchProjects = state.project.searchProjects;
    const requesting =
        projects && searchProjects
            ? projects.requesting || searchProjects.requesting
                ? true
                : false
            : false;

    return {
        projects,
        requesting,
    };
};


Projects.propTypes = {
    fetchProjects: PropTypes.func.isRequired,
    searchProjects: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    projects: PropTypes.object,
    userId: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(Projects);
