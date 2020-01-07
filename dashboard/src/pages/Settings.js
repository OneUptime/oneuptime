import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Dashboard from '../components/Dashboard';
import APISettings from '../components/settings/APISettings';
import ProjectSettings from '../components/settings/ProjectSettings';
import SubProjects from '../components/settings/SubProjects';
import DeleteProject from '../components/settings/DeleteProject';
import RenderIfMember from '../components/basic/RenderIfMember';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import ExitProject from '../components/settings/ExitProject';
import { hideDeleteModal } from '../actions/project';
import PropTypes from 'prop-types';
import { IS_DEV } from '../config';
import { logEvent } from '../analytics'; 

class Settings extends Component {
  componentDidMount() {
    if (!IS_DEV) {
      logEvent('Project Settings Page Loaded');
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
    return (
      <Dashboard>
        <div onKeyDown={this.handleKeyBoard} className="Margin-vertical--12">
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
  hideDeleteModal: PropTypes.func.isRequired
};

Settings.displayName = 'Settings';

export default connect(null, mapDispatchToProps)(Settings);
