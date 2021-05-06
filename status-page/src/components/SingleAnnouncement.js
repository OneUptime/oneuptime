import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { getSingleAnnouncement, getStatusPage } from '../actions/status';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import { handleResources } from '../config';

class SingleAnnouncement extends Component {
    async componentDidMount() {
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
    render() {
        const {
            statusPage: { theme },
            announcement,
            monitorState,
        } = this.props;

        return (
            <div>
                {theme === 'Clean Theme' ? (
                    <>
                        {announcement && (
                            <div>
                                <div className="annoucement_frame2 annoucement_frame">
                                    <div
                                        className="font-largest"
                                        style={{
                                            fontSize: '20px',
                                        }}
                                    >
                                        Announcement Info
                                    </div>
                                    <div
                                        className="announcement_block announcement_block2"
                                        onClick={e => {
                                            e.preventDefault();
                                            this.handleRouting(
                                                announcement?.slug
                                            );
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: '18px',
                                                borderBottom: '0',
                                                marginBottom: '0',
                                            }}
                                            className="date-big"
                                        >
                                            {announcement &&
                                                moment(
                                                    announcement.createdAt
                                                ).format('LL')}
                                        </div>
                                        <div className="announce_title">
                                            {announcement?.name}
                                        </div>
                                        <div className="incident_desc">
                                            {announcement?.description}
                                        </div>
                                        <div className="new_res">
                                            <span>Resource Affected:</span>{' '}
                                            <span>
                                                {handleResources(
                                                    monitorState,
                                                    announcement
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                ) : theme === 'Classic Theme' ? (
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
                                                        color:
                                                            'rgba(76, 76, 76, 0.52)',
                                                        textTransform:
                                                            'uppercase',
                                                        fontWeight: '700',
                                                        display: 'inline-block',
                                                        marginBottom: 20,
                                                        fontSize: 14,
                                                    }}
                                                >
                                                    Announcement Info
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
                                                            textTransform:
                                                                'unset',
                                                        }}
                                                    >
                                                        {announcement?.name}
                                                    </span>
                                                    <span
                                                        style={{
                                                            color:
                                                                'rgba(0, 0, 0, 0.5)',
                                                        }}
                                                    >
                                                        {
                                                            announcement?.description
                                                        }
                                                    </span>
                                                </div>
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
                                                        Resource Affected:
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
                                                <div className="classic_date">
                                                    {announcement &&
                                                        moment(
                                                            announcement.createdAt
                                                        ).format('LL')}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}
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

const mapStateToProps = state => {
    return {
        statusPage: state.status.statusPage,
        announcement: state.status.announcements.singleAnnouncement,
        monitorState: state.status.statusPage.monitorsData,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getSingleAnnouncement, getStatusPage }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(SingleAnnouncement);
