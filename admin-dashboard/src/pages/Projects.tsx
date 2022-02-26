import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ProjectList from '../components/project/ProjectList';
import { fetchProjects, searchProjects } from '../actions/project';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'loda... Remove this comment to see the full error message
import * as _ from 'lodash';
class Projects extends React.Component {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);

        this.state = {
            searchBox: null,
            page: 1,
        };
    }

    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searchBox' does not exist on type 'Reado... Remove this comment to see the full error message
        const { searchBox } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjects' does not exist on type 'R... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searchBox' does not exist on type 'Reado... Remove this comment to see the full error message
        const { searchBox } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjects' does not exist on type 'R... Remove this comment to see the full error message
        const { fetchProjects, searchProjects } = this.props;

        if (searchBox && searchBox !== '') {
            searchProjects(searchBox, skip + limit, 10);
        } else {
            fetchProjects(skip + limit, 10);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };

    componentDidMount = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjects' does not exist on type 'R... Remove this comment to see the full error message
        this.props.fetchProjects();
    };

    onChange = (e: $TSFixMe) => {
        const value = e.target.value;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searchProjects' does not exist on type '... Remove this comment to see the full error message
        const { searchProjects } = this.props;

        this.setState({ searchBox: value });
        searchProjects(value, 0, 10);
        this.setState({ page: 1 });
    };

    render() {
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
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projects: any; prevClicked: (skip: any, li... Remove this comment to see the full error message
                                            projects={this.props.projects || {}}
                                            prevClicked={this.prevClicked}
                                            nextClicked={this.nextClicked}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
                                            userId={this.props.userId}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
                                            requesting={this.props.requesting}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Projects.displayName = 'Projects';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ fetchProjects, searchProjects }, dispatch);
};

const mapStateToProps = (state: $TSFixMe) => {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Projects.propTypes = {
    fetchProjects: PropTypes.func.isRequired,
    searchProjects: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    projects: PropTypes.object,
    userId: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(Projects);
