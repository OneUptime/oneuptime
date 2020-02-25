import React from 'react';
import { withRouter } from 'react-router-dom';
import PropTypes from 'prop-types';
import WebHookList from './WebHookList';
import WebHookButton from './WebHookButton';
import RenderIfAdmin from '../basic/RenderIfAdmin';

class WebHookBox extends React.Component {

    render() {
        return (
            <div className="Box-root Margin-vertical--12">
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                <span>Webhooks Integration</span>
                                            </span>
                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Integrate Fyipe with your Webhooks.
                                                        </span>
                                            </span>
                                        </div>
                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                            <div className="Box-root">
                                                <RenderIfAdmin>
                                                    <WebHookButton monitorId={this.props.monitorId}/>
                                                </RenderIfAdmin>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <WebHookList monitorId={this.props.monitorId}/>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

WebHookBox.displayName = 'WebHookBox';

WebHookBox.propTypes = {
	monitorId: PropTypes.string,
};

export default withRouter(WebHookBox);