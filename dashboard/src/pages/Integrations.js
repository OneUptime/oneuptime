import React, { Component } from 'react';
import { PropTypes } from 'prop-types';
import Fade from 'react-reveal/Fade';
import WebHookBox from '../components/webHooks/WebHookBox';
import ZapierBox from '../components/zapier/ZapierBox';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import MSTeamsBox from '../components/webHooks/MSTeamsBox';
import SlackBox from '../components/webHooks/SlackBox';
import IncomingRequestBox from '../components/webHooks/IncomingRequestBox';
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';

class Integrations extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            tabIndex: 0,
        };
    }
    componentWillMount() {
        resetIdCounter();
    }
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > SETTINGS > INTEGRATION');
        }
    }
    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };
    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Fade>
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Integrations" />
                <Tabs
                    selectedTabClassName={'custom-tab-selected'}
                    onSelect={tabIndex => this.tabSelected(tabIndex)}
                    selectedIndex={this.state.tabIndex}
                >
                    <div className="Flex-flex Flex-direction--columnReverse">
                        <TabList
                            id="customTabList"
                            className={'custom-tab-list'}
                        >
                            <Tab
                                className={
                                    'custom-tab custom-tab-3 webhook-tab'
                                }
                            >
                                Webhooks
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-3 http-request-tab'
                                }
                            >
                                Incoming Http Request
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-3 http-request-tab'
                                }
                            >
                                Microsoft, Slack and Zapier
                            </Tab>
                            <div id="tab-slider" className="custom-tab-3"></div>
                        </TabList>
                    </div>
                    <TabPanel>
                        <Fade>
                            <WebHookBox />
                        </Fade>
                    </TabPanel>
                    <TabPanel>
                        <Fade>
                            <IncomingRequestBox />
                        </Fade>
                    </TabPanel>
                    <TabPanel>
                        <Fade>
                            <MSTeamsBox />
                            <SlackBox />
                            <ZapierBox />
                        </Fade>
                    </TabPanel>
                </Tabs>
            </Fade>
        );
    }
}

Integrations.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

Integrations.displayName = 'Integrations';

export default Integrations;
