import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
//import Slack from '../components/slack/Slack';
import WebHookBox from '../components/webHooks/WebHookBox';

class Integrations extends Component {

  constructor(props) {
    super(props);
    this.props = props;
  }

  componentDidMount() {
      if(window.location.href.indexOf('localhost') <= -1){
      this.context.mixpanel.track('Integration page Loaded');
    }
  }

    render() {
      return (
        <Dashboard>
        {/* <Slack />*/}
          <WebHookBox />
        </Dashboard>
      );
    }
}

Integrations.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

Integrations.displayName = 'Integrations'

export default Integrations;
