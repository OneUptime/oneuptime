import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { Fade } from 'react-awesome-reveal';
import DeleteProject from '../components/settings/DeleteProject';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import { hideDeleteModal } from '../actions/project';
import PropTypes from 'prop-types';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

interface AdvancedProps {
    hideDeleteModal: Function;
    location?: {
        pathname?: string
    };
    currentProject: object;
    switchToProjectViewerNav?: boolean;
}

class Advanced extends Component<AdvancedProps> {
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                this.props.hideDeleteModal();
                return true;
            default:
                return false;
        }
    };

    render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem route={pathname} name="Advanced" />
                <div
                    onKeyDown={this.handleKeyBoard}
                    className="Margin-vertical--12"
                >
                    <div>
                        <div id="advancedPage">
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span>
                                        <div>
                                            <RenderIfOwner>
                                                <DeleteProject />
                                            </RenderIfOwner>
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ hideDeleteModal }, dispatch);


Advanced.propTypes = {
    hideDeleteModal: PropTypes.func.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};


Advanced.displayName = 'Advanced';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(Advanced);
