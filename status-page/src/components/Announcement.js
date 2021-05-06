import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { getAnnouncements } from '../actions/status';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import { handleResources } from '../config';
import ShouldRender from './ShouldRender';

class Announcement extends Component {
    constructor(props) {
        super(props);
        this.limit = 2;
        this.counter = 2;
    }
    async componentDidMount() {
        const {
            getAnnouncements,
            statusPage: { projectId, _id },
        } = this.props;
        await getAnnouncements(projectId._id, _id, 0, this.limit);
    }

    handleRouting = announcementSlug => {
        const {
            history,
            statusPage: { slug },
        } = this.props;
        history.push(`/status-page/${slug}/announcement/${announcementSlug}`);
    };

    addMore = async () => {
        const {
            getAnnouncements,
            statusPage: { projectId, _id },
        } = this.props;
        this.limit += this.counter;
        await getAnnouncements(projectId._id, _id, 0, this.limit);
    };

    render() {
        const {
            announcements: { allAnnouncements, count },
            monitorState,
        } = this.props;
        return (
            <>
                {allAnnouncements && allAnnouncements.length > 0 && (
                    <>
                        {this.props.theme ? (
                            <div className="annoucement_frame">
                                <div
                                    className="font-largest"
                                    style={{
                                        ...this.props.heading,
                                        fontSize: '20px',
                                    }}
                                >
                                    Announcements
                                </div>
                                <div>
                                    {allAnnouncements.map(
                                        (announcement, index) => {
                                            return (
                                                <>
                                                    <div
                                                        className="announcement_block"
                                                        onClick={e => {
                                                            e.preventDefault();
                                                            this.handleRouting(
                                                                announcement.slug
                                                            );
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                fontSize:
                                                                    '18px',
                                                                borderBottom:
                                                                    '0',
                                                                marginBottom:
                                                                    '0',
                                                            }}
                                                            className="date-big"
                                                            key={index}
                                                        >
                                                            {moment(
                                                                announcement.createdAt
                                                            ).format('LL')}
                                                        </div>
                                                        <div className="announce_title">
                                                            {announcement.name}
                                                        </div>
                                                        <div className="incident_desc">
                                                            {announcement
                                                                .description
                                                                .length > 150
                                                                ? announcement.description.slice(
                                                                      0,
                                                                      150
                                                                  ) + '...'
                                                                : announcement.description}
                                                        </div>
                                                        <div className="new_res">
                                                            <span>
                                                                Resource
                                                                Affected:
                                                            </span>{' '}
                                                            <span>
                                                                {handleResources(
                                                                    monitorState,
                                                                    announcement
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </>
                                            );
                                        }
                                    )}
                                </div>
                                <ShouldRender if={this.limit < count}>
                                    <div className="new_show_btn">
                                        <button onClick={() => this.addMore()}>
                                            show more
                                        </button>
                                    </div>
                                </ShouldRender>
                            </div>
                        ) : (
                            <div className="announcement_classic">
                                <div className="feed-title ann_header">
                                    Announcements
                                </div>
                                <ul className="ul_announce">
                                    {allAnnouncements.map(
                                        (announcement, index) => {
                                            return (
                                                <>
                                                    <li
                                                        className="ann_items"
                                                        key={index}
                                                        onClick={e => {
                                                            e.preventDefault();
                                                            this.handleRouting(
                                                                announcement.slug
                                                            );
                                                        }}
                                                    >
                                                        <div className="classic_ann_title">
                                                            {announcement.name}
                                                        </div>
                                                        <div className="classic_ann_desc">
                                                            {announcement
                                                                .description
                                                                .length > 150
                                                                ? announcement.description.slice(
                                                                      0,
                                                                      150
                                                                  ) + '...'
                                                                : announcement.description}
                                                        </div>
                                                        <div className="classic_res">
                                                            <span
                                                                style={{
                                                                    fontSize:
                                                                        '14px',
                                                                }}
                                                            >
                                                                Resource
                                                                Affected:
                                                            </span>{' '}
                                                            <span
                                                                style={{
                                                                    fontSize:
                                                                        '14px',
                                                                }}
                                                            >
                                                                {handleResources(
                                                                    monitorState,
                                                                    announcement
                                                                )}
                                                            </span>{' '}
                                                        </div>
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                justifyContent:
                                                                    'space-between',
                                                                alignItems:
                                                                    'center',
                                                            }}
                                                        >
                                                            <span
                                                                className="time"
                                                                style={{
                                                                    marginLeft: 0,
                                                                    paddingBottom: 10,
                                                                    color:
                                                                        'rgba(76, 76, 76, 0.8)',
                                                                    fontSize:
                                                                        '14px',
                                                                }}
                                                            >
                                                                {moment(
                                                                    announcement.createdAt
                                                                ).format('LL')}
                                                            </span>
                                                            <span className="sp__icon sp__icon--forward"></span>
                                                        </div>
                                                    </li>
                                                </>
                                            );
                                        }
                                    )}
                                </ul>
                                <ShouldRender if={this.limit < count}>
                                    <div className="classic_more">
                                        <button
                                            className="more button-as-anchor anchor-centered"
                                            onClick={() => this.addMore()}
                                        >
                                            more
                                        </button>
                                    </div>
                                </ShouldRender>
                            </div>
                        )}
                    </>
                )}
            </>
        );
    }
}

Announcement.displayName = 'Announcement';

Announcement.propTypes = {
    theme: PropTypes.string,
    heading: PropTypes.object,
    getAnnouncements: PropTypes.func,
    statusPage: PropTypes.object,
    announcements: PropTypes.object,
    monitorState: PropTypes.array,
    history: PropTypes.object,
};

const mapStateToProps = state => {
    return {
        statusPage: state.status.statusPage,
        announcements: state.status.announcements.list,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getAnnouncements }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(Announcement);
