import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { User } from '../../config';
import SlackTeamList from './SlackTeamList';
import RenderIfAdmin from '../basic/RenderIfAdmin';

class Slack extends React.Component {
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId } = this.props;
        const userToken = User.getAccessToken();
        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <br />
                                <br />
                                <br />
                                <br />
                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                <span>Slack Integration</span>
                                            </span>
                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Connect your project to your
                                                    slack workspace.
                                                </span>
                                            </span>
                                        </div>
                                        <div
                                            className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16"
                                            style={{ paddingRight: 5 }}
                                        >
                                            <div className="Box-root">
                                                <RenderIfAdmin>
                                                    <a
                                                        href={`https://slack.com/oauth/authorize?client_id=3133949145.437395941636&state=${projectId},${userToken}&scope=incoming-webhook,bot,commands,chat:write:bot,team:read,reminders:write,chat:write:user,channels:history,channels:read`}
                                                        className="Button bs-ButtonLegacy"
                                                    >
                                                        <img
                                                            alt="Add to Slack"
                                                            height="32"
                                                            width="126"
                                                            src="https://platform.slack-edge.com/img/add_to_slack.png"
                                                            srcSet="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x"
                                                        />
                                                    </a>
                                                </RenderIfAdmin>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; }' is not assignable to ty... Remove this comment to see the full error message
                                <SlackTeamList projectId={projectId} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Slack.displayName = 'Slack';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Slack.propTypes = {
    projectId: PropTypes.string.isRequired,
};

const mapStateToProps = (state: $TSFixMe) => ({
    projectId: state.project.currentProject && state.project.currentProject._id
});

export default connect(mapStateToProps)(withRouter(Slack));
