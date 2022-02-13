import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { history } from '../../store';
import PropTypes from 'prop-types';
import {
    switchStatusPage,
    fetchSubProjectStatusPages,
    fetchProjectStatusPage,
    paginate,
} from '../../actions/statusPage';
import { openModal, closeModal } from '../../actions/modal';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

class StatusPagesTable extends Component {
    constructor(props) {
        super(props);
        this.state = { statusPageModalId: uuidv4() };
    }

    ready = () => {
        if (this.props.projectId) {
            this.props
                .fetchSubProjectStatusPages(this.props.projectId)
                .then(res => {
                    if (res.data.length > 0) {
                        res.data.forEach(proj => {
                            this.setState({ [proj._id]: 1 });
                        });
                    }
                });
        }
    };

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > STATUS PAGES > STATUS PAGE'
            );
        }

        this.ready();
    }

    componentDidUpdate(prevProps) {
        if (!this.state[this.props.projectId]) {
            this.props.subProjectStatusPages.forEach(proj => {
                this.setState({ [proj._id]: 1 });
            });
        }

        if (prevProps.projectId !== this.props.projectId) {
            this.ready();
        }
    }

    switchStatusPages = (statusPage, path) => {
        this.props.switchStatusPage(statusPage);
        history.push(path);
    };

    prevClicked = (projectId, skip, limit) => {
        const { fetchProjectStatusPage, paginate } = this.props;

        fetchProjectStatusPage(
            projectId,
            false,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
        this.setState({ [projectId]: this.state[projectId] - 1 });
        paginate('prev');
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > STATUS PAGES > FETCH PREV STATUS PAGE'
            );
        }
    };

    nextClicked = (projectId, skip, limit) => {
        const { fetchProjectStatusPage, paginate } = this.props;
        fetchProjectStatusPage(projectId, false, skip + limit, 10);
        this.setState({ [projectId]: this.state[projectId] + 1 });
        paginate('next');
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > STATUS PAGES > FETCH NEXT STATUS PAGE'
            );
        }
    };

    render() {
        const {
            subProjects,
            isRequesting,
            subProjectStatusPages,
            currentProject,
        } = this.props;
        const currentProjectId = this.props.projectId;

        // Add Project Statuspages to All Statuspages List
        let projectStatusPage = subProjectStatusPages.find(
            subProjectStatusPage =>
                subProjectStatusPage._id === currentProjectId
        );
        let { skip, limit } = projectStatusPage;
        const { count } = projectStatusPage;
        skip = parseInt(skip);
        limit = parseInt(limit);
        const statusPages = projectStatusPage.statusPages;
        let canPaginateForward =
            statusPages && count && count > skip + limit ? true : false;
        let canPaginateBackward = statusPages && skip <= 0 ? false : true;

        if (projectStatusPage && (isRequesting || !statusPages)) {
            canPaginateForward = false;
            canPaginateBackward = false;
        }

        const subProjectName =
            subProjects.find(obj => obj._id === currentProjectId)?.name ||
            currentProject.name;
        projectStatusPage =
            projectStatusPage && projectStatusPage.statusPages ? (
                <RenderIfUserInSubProject
                    subProjectId={projectStatusPage._id}
                    key={() => uuidv4()}
                >
                    <div id="statusPageTable" className="bs-BIM">
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <StatuspageProjectBox
                                    switchStatusPages={this.switchStatusPages}
                                    subProjectStatusPage={projectStatusPage}
                                    statusPages={statusPages}
                                    canPaginateBackward={canPaginateBackward}
                                    canPaginateForward={canPaginateForward}
                                    skip={skip}
                                    limit={limit}
                                    subProjectName={subProjectName}
                                    showProjectName={
                                        currentProject?._id !== currentProjectId
                                    }
                                    currentProjectId={currentProjectId}
                                    statusPageModalId={
                                        this.state.statusPageModalId
                                    }
                                    openModal={this.props.openModal}
                                    statusPage={this.props.statusPage}
                                    prevClicked={this.prevClicked}
                                    nextClicked={this.nextClicked}
                                    subProjects={subProjects}
                                    allStatusPageLength={
                                        subProjectStatusPages.length
                                    }
                                    modalList={this.props.modalList}
                                    project={currentProject}
                                    pages={this.state[projectStatusPage._id]}
                                    switchToProjectViewerNav={
                                        this.props.switchToProjectViewerNav
                                    }
                                />
                            </div>
                        </div>
                    </div>
                </RenderIfUserInSubProject>
            ) : (
                false
            );

        const allStatusPages = projectStatusPage && [projectStatusPage];

        return allStatusPages;
    }
}

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            closeModal,
            switchStatusPage,
            fetchSubProjectStatusPages,
            paginate,
            fetchProjectStatusPage,
        },
        dispatch
    );

function mapStateToProps(state, ownProps) {
    const currentProject = state.project.currentProject;
    const currentProjectId = currentProject._id;
    const statusPages = state.statusPage.subProjectStatusPages;

    // find project statuspages or assign default value
    let projectStatusPage = statusPages.find(
        statusPage => statusPage._id === currentProjectId
    );
    projectStatusPage = projectStatusPage
        ? projectStatusPage
        : {
              _id: currentProjectId,
              statusPages: [],
              count: 0,
              skip: 0,
              limit: 10,
          };

    // find subproject statuspages or assign default value
    const subProjectStatusPages = subProjects.map(subProject => {
        const statusPage = statusPages.find(
            statusPage => statusPage._id === subProject._id
        );
        return statusPage
            ? statusPage
            : {
                  _id: subProject._id,
                  statusPages: [],
                  count: 0,
                  skip: 0,
                  limit: 10,
              };
    });

    return {
        currentProject,
        statusPage: state.statusPage,
        isRequesting: state.statusPage.requesting,
        modalList: state.modal.modals,
    };
}

StatusPagesTable.propTypes = {
    subProjectStatusPages: PropTypes.array.isRequired,
    currentProject: PropTypes.object.isRequired,
    statusPage: PropTypes.object.isRequired,
    switchStatusPage: PropTypes.func.isRequired,
    fetchSubProjectStatusPages: PropTypes.func.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    paginate: PropTypes.func.isRequired,
    projectId: PropTypes.string.isRequired,
    isRequesting: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.oneOf([null, undefined]),
    ]),
    openModal: PropTypes.func.isRequired,
    subProjects: PropTypes.array.isRequired,
    modalList: PropTypes.array,
    switchToProjectViewerNav: PropTypes.bool,
};

StatusPagesTable.displayName = 'StatusPagesTable';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPagesTable);
