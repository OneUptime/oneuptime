import React, { Component } from 'react';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
import { getSingleAnnouncement, getStatusPage } from '../actions/status';
import { bindActionCreators } from 'redux';
import { handleResources } from '../config';
import ShouldRender from './ShouldRender';
import Markdown from 'markdown-to-jsx';
class SingleAnnouncement extends Component {
    async componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
            match: {
                params: { announcementSlug, statusPageSlug },
            },
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getStatusPage' does not exist on type 'R... Remove this comment to see the full error message
        await this.props.getStatusPage(statusPageSlug, 'null');
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getSingleAnnouncement' does not exist on... Remove this comment to see the full error message
        await this.props.getSingleAnnouncement(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statusPage.projectId._id,
            statusPageSlug,
            announcementSlug
        );
    }
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'announcement' does not exist on type 'Re... Remove this comment to see the full error message
        const { announcement, monitorState } = this.props;

        return (
            <div>
                {announcement && (
                    <div
                        className="page-main-wrapper"
                        style={{ background: 'rgb(247, 247, 247)' }}
                    >
                        <div className="innernew">
                            <div
                                id="incident"
                                className="twitter-feed white box"
                                style={{ overflow: 'visible' }}
                            >
                                <div
                                    className="messages"
                                    style={{
                                        position: 'relative',
                                    }}
                                >
                                    <div
                                        className="box-inner"
                                        style={{
                                            paddingTop: 20,
                                            paddingBottom: 20,
                                        }}
                                    >
                                        <span
                                            style={{
                                                color: 'rgba(76, 76, 76, 0.52)',
                                                textTransform: 'uppercase',
                                                fontWeight: '700',
                                                display: 'inline-block',
                                                marginBottom: 20,
                                                fontSize: 12,
                                            }}
                                        >
                                            <Translate>
                                                Announcement Info
                                            </Translate>
                                        </span>
                                        <div
                                            className="individual-header"
                                            style={{
                                                marginBottom: 25,
                                            }}
                                        >
                                            <span
                                                className="feed-title"
                                                style={{
                                                    color:
                                                        'rgba(76, 76, 76, 0.8)',
                                                    fontWeight: 'bold',
                                                    marginBottom: 25,
                                                    textTransform: 'unset',
                                                }}
                                            >
                                                {announcement?.name}
                                            </span>
                                            <span
                                                style={{
                                                    color: 'rgba(0, 0, 0, 0.5)',
                                                    whiteSpace: 'pre-wrap',
                                                }}
                                            >
                                                {announcement.description &&
                                                    announcement.description
                                                        .split('\n')
                                                        .map((elem: $TSFixMe, index: $TSFixMe) => (
                                                            <Markdown
                                                                key={`${elem}-${index}`}
                                                                options={{
                                                                    forceBlock: true,
                                                                }}
                                                            >
                                                                {elem}
                                                            </Markdown>
                                                        ))}
                                            </span>
                                        </div>
                                        <ShouldRender
                                            if={
                                                announcement.monitors.length > 0
                                            }
                                        >
                                            <div
                                                className="ongoing__affectedmonitor"
                                                style={{ marginTop: 0 }}
                                            >
                                                <span
                                                    className="ongoing__affectedmonitor--title"
                                                    style={{
                                                        color:
                                                            'rgba(76, 76, 76, 0.8)',
                                                    }}
                                                >
                                                    <Translate>
                                                        Resource Affected:
                                                    </Translate>
                                                </span>{' '}
                                                <span
                                                    className="ongoing__affectedmonitor--content"
                                                    style={{
                                                        color:
                                                            'rgba(0, 0, 0, 0.5)',
                                                    }}
                                                >
                                                    {handleResources(
                                                        monitorState,
                                                        announcement
                                                    )}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SingleAnnouncement.displayName = 'SingleAnnouncement';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SingleAnnouncement.propTypes = {
    statusPage: PropTypes.object,
    getSingleAnnouncement: PropTypes.func,
    match: PropTypes.object,
    getStatusPage: PropTypes.func,
    announcement: PropTypes.object,
    monitorState: PropTypes.array,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        statusPage: state.status.statusPage,
        announcement: state.status.announcements.singleAnnouncement,
        monitorState: state.status.statusPage.monitorsData,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ getSingleAnnouncement, getStatusPage }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(SingleAnnouncement);
