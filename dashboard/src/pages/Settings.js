import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Dashboard from '../components/Dashboard';
import APISettings from '../components/settings/APISettings';
import ProjectSettings from '../components/settings/ProjectSettings';
import SubProjects from '../components/settings/SubProjects';
import MonitorCategories from '../components/settings/MonitorCategories';
import DeleteProject from '../components/settings/DeleteProject';
import ChangePlan from '../components/settings/ChangePlan';
import RenderIfMember from '../components/basic/RenderIfMember';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import RenderIfAdmin from '../components/basic/RenderIfAdmin';
import ExitProject from '../components/settings/ExitProject';
import { hideDeleteModal } from '../actions/project';
import PropTypes from 'prop-types';

class Settings extends Component {
    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Project Settings Page Loaded');
        }
    }

    handleKeyBoard = (e) => {
        switch (e.key) {
            case 'Escape':
                this.props.hideDeleteModal()
                return true;
            default:
                return false;
        }
    }

    render() {
        return (
            <Dashboard>
                <div onKeyDown={this.handleKeyBoard} className="db-World-contentPane Box-root Padding-bottom--48">
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

                                                <APISettings />

                                                <RenderIfOwner>
                                                    <ChangePlan />
                                                </RenderIfOwner>

                                                 <RenderIfOwner>
                                                    <SubProjects />
                                                </RenderIfOwner>

                                                <RenderIfAdmin>
                                                    <MonitorCategories />
                                                </RenderIfAdmin>

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
        )
    }
}

const mapDispatchToProps = dispatch => (
    bindActionCreators({ hideDeleteModal }, dispatch)
)


Settings.propTypes = {
    hideDeleteModal: PropTypes.func.isRequired,
};

Settings.contextTypes = {
    mixpanel: PropTypes.object.isRequired,
};

Settings.displayName = 'Settings'

export default connect(null, mapDispatchToProps)(Settings);
