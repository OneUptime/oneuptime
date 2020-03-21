import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import WebHookBox from '../components/webHooks/WebHookBox';
import ZapierBox from '../components/zapier/ZapierBox';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';

class Integrations extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Integration page Loaded');
        }
    }

    render() {
        return (
            <Dashboard>
                {/* <Slack />*/}
                <WebHookBox />
                <ZapierBox />
            </Dashboard>
        );
    }
}

Integrations.displayName = 'Integrations';

export default Integrations;
