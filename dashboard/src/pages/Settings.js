import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Dashboard from '../components/Dashboard';
import ProjectSettings from '../components/settings/ProjectSettings';
import SubProjects from '../components/settings/SubProjects';
import DeleteProject from '../components/settings/DeleteProject';
import RenderIfMember from '../components/basic/RenderIfMember';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import ExitProject from '../components/settings/ExitProject';
import { hideDeleteModal } from '../actions/project';
import PropTypes from 'prop-types';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { logEvent } from '../analytics';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

class Settings extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > SETTINGS');
        }
    }

    handleKeyBoard = e => {
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
        } = this.props;

        return (
            <Dashboard>
                <BreadCrumbItem route={pathname} name="Project Settings" />
                <div
                    onKeyDown={this.handleKeyBoard}
                    className="Margin-vertical--12"
                >
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span>
                                        <div>
                                            <div>
                                                <RenderIfOwner>
                                                    <ProjectSettings />
                                                </RenderIfOwner>

                                                <RenderIfOwner>
                                                    <SubProjects />
                                                </RenderIfOwner>

                                                <RenderIfOwner>
                                                    <DeleteProject />
                                                </RenderIfOwner>

                                                <RenderIfMember>
                                                    <ExitProject />
                                                </RenderIfMember>
                                            </div>
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

const mapDispatchToProps = dispatch =>
    bindActionCreators({ hideDeleteModal }, dispatch);

Settings.propTypes = {
    hideDeleteModal: PropTypes.func.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

Settings.displayName = 'Settings';

export default connect(null, mapDispatchToProps)(Settings);
