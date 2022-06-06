import React, { Component } from 'react';
import { connect } from 'react-redux';

import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
import { getSingleAnnouncement, getStatusPage } from '../actions/status';
import { bindActionCreators, Dispatch } from 'redux';
import { handleResources } from '../config';
import ShouldRender from './ShouldRender';
import Markdown from 'markdown-to-jsx';

interface SingleAnnouncementProps {
    statusPage?: object;
    getSingleAnnouncement?: Function;
    match?: object;
    getStatusPage?: Function;
    announcement?: object;
    monitorState?: unknown[];
}

class SingleAnnouncement extends Component<ComponentProps> {
    override async componentDidMount() {
        const {
            match: {
                params: { announcementSlug, statusPageSlug },
            },
        } = this.props;

        await this.props.getStatusPage(statusPageSlug, 'null');

        await this.props.getSingleAnnouncement(
            this.props.statusPage.projectId._id,
            statusPageSlug,
            announcementSlug
        );
    }
    override render() {
        const { announcement, monitorState }: $TSFixMe = this.props;

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
                                                    color: 'rgba(76, 76, 76, 0.8)',
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
                                                        .map(
                                                            (
                                                                elem: $TSFixMe,
                                                                index: $TSFixMe
                                                            ) => {
                                                                return (
                                                                    <Markdown
                                                                        key={`${elem}-${index}`}
                                                                        options={{
                                                                            forceBlock:
                                                                                true,
                                                                        }}
                                                                    >
                                                                        {elem}
                                                                    </Markdown>
                                                                );
                                                            }
                                                        )}
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
                                                        color: 'rgba(76, 76, 76, 0.8)',
                                                    }}
                                                >
                                                    <Translate>
                                                        Resource Affected:
                                                    </Translate>
                                                </span>{' '}
                                                <span
                                                    className="ongoing__affectedmonitor--content"
                                                    style={{
                                                        color: 'rgba(0, 0, 0, 0.5)',
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

SingleAnnouncement.displayName = 'SingleAnnouncement';

SingleAnnouncement.propTypes = {
    statusPage: PropTypes.object,
    getSingleAnnouncement: PropTypes.func,
    match: PropTypes.object,
    getStatusPage: PropTypes.func,
    announcement: PropTypes.object,
    monitorState: PropTypes.array,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        statusPage: state.status.statusPage,
        announcement: state.status.announcements.singleAnnouncement,
        monitorState: state.status.statusPage.monitorsData,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        { getSingleAnnouncement, getStatusPage },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(SingleAnnouncement);
