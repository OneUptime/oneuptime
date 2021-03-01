import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import Notes from './Notes';
import ShouldRender from './ShouldRender';
import SubscribeBox from './Subscribe/SubscribeBox';
import {
    getStatusPageNote,
    getStatusPageIndividualNote,
    getMoreNote,
    fetchLastIncidentTimelines,
    showIncidentCard,
} from '../actions/status';
import { openSubscribeMenu } from '../actions/subscribe';
const countNum = 15;

class NotesMain extends Component {
    constructor(props) {
        super(props);

        this.getAll = this.getAll.bind(this);
        this.more = this.more.bind(this);
        this.subscribebutton = this.subscribebutton.bind(this);
    }

    componentDidMount() {
        this.props.fetchLastIncidentTimelines(
            this.props.projectId,
            this.props.statusPageId
        );
        this.props.getStatusPageNote(
            this.props.projectId,
            this.props.statusPageId,
            0,
            this.props.theme && countNum
        );
    }

    componentDidUpdate(prevProps) {
        if (prevProps.statusPage !== this.props.statusPage) {
            if (this.props.individualnote) {
                this.props.getStatusPageIndividualNote(
                    this.props.projectId,
                    this.props.individualnote._id,
                    this.props.individualnote.date,
                    this.props.individualnote.name,
                    true
                );
            }
        }
    }

    getAll = () => {
        this.props.showIncidentCard(true);
        this.props.getStatusPageNote(
            this.props.projectId,
            this.props.statusPageId,
            0
        );
    };

    more = () => {
        this.props.getMoreNote(
            this.props.projectId,
            this.props.statusPageId,
            this.props.skip + 5
        );
        this.props.fetchLastIncidentTimelines(
            this.props.projectId,
            this.props.statusPageId
        );
    };

    subscribebutton = () => {
        this.props.openSubscribeMenu();
    };

    render() {
        let note = '';
        let contentBackground,
            primaryTextColor,
            secondaryTextColor,
            downtimeColor,
            uptimeColor,
            degradedColor,
            noteBackgroundColor;
        const subheading = {};
        if (this.props.statusPage) {
            const colors = this.props.statusPage.colors;
            contentBackground = {
                background: `rgba(${colors.statusPageBackground.r}, ${colors.statusPageBackground.g}, ${colors.statusPageBackground.b}, ${colors.statusPageBackground.a})`,
            };
            subheading.color = `rgba(${colors.subheading.r}, ${colors.subheading.g}, ${colors.subheading.b}, ${colors.subheading.a})`;
            primaryTextColor = {
                color: `rgba(${colors.primaryText.r}, ${colors.primaryText.g}, ${colors.primaryText.b}, ${colors.primaryText.a})`,
            };
            secondaryTextColor = {
                color: `rgba(${colors.secondaryText.r}, ${colors.secondaryText.g}, ${colors.secondaryText.b}, ${colors.secondaryText.a})`,
            };
            downtimeColor = {
                backgroundColor: `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b})`,
            };
            uptimeColor = {
                backgroundColor: `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b})`,
            };
            degradedColor = {
                backgroundColor: `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b})`,
            };
            noteBackgroundColor = {
                background: `rgba(${colors.noteBackground.r}, ${colors.noteBackground.g}, ${colors.noteBackground.b})`,
            };
        }
        if (
            this.props.noteData &&
            this.props.noteData.notes &&
            this.props.lastIncidentTimelines
        ) {
            note = (
                <Notes
                    notes={this.props.noteData.notes}
                    secondaryTextColor={secondaryTextColor}
                    primaryTextColor={primaryTextColor}
                    downtimeColor={downtimeColor}
                    uptimeColor={uptimeColor}
                    degradedColor={degradedColor}
                    noteBackgroundColor={noteBackgroundColor}
                    statusPageId={this.props.statusPageId}
                    incidentTimelines={this.props.lastIncidentTimelines}
                />
            );
        }
        const {
            enableRSSFeed,
            smsNotification,
            webhookNotification,
            emailNotification,
        } = this.props.statusPage;
        const showSubscriberOption =
            enableRSSFeed ||
            smsNotification ||
            webhookNotification ||
            emailNotification;

        const checkDuplicateDates = items => {
            const track = {};

            const result = [];

            for (let item of items) {
                const date = String(item.createdAt).slice(0, 10);

                if (!track[date]) {
                    item.style = true;
                    track[date] = date;
                } else {
                    item.style = false;
                }

                result.push(item);
            }

            return result;
        };

        const formatMsg = data => {
            let result = data.reduce(function(r, a) {
                r[a.incident_state] = r[a.incident_state] || [];
                r[a.incident_state].push(a);
                return r;
            }, Object.create({}));

            return result;
        };

        let incidentNoteData = this.props.noteData;
        if (
            this.props.theme === 'Clean Theme' &&
            this.props.noteData.notes.length > countNum &&
            !this.props.noteData.notes[1].idNumber &&
            !this.props.noteData.notes[1].style
        ) {
            this.props.noteData.notes.splice(1, 1);
            incidentNoteData.notes = this.props.noteData.notes;
        }

        if (this.props.theme === 'Clean Theme') {
            return incidentNoteData && incidentNoteData.notes.length > 1 ? (
                checkDuplicateDates(incidentNoteData.notes).map((note, i) => {
                    return (
                        <div className="incident-object" key={i}>
                            <ShouldRender if={note.style}>
                                <div className="date-big">
                                    {moment(note.createdAt).format('LL')}
                                </div>
                            </ShouldRender>
                            <ShouldRender if={!note.style}>
                                <div className="border-width-90"></div>
                            </ShouldRender>
                            {note.idNumber ? (
                                <>
                                    <div className="list_k">
                                        <b>{note.title}</b>
                                    </div>
                                    <div className="incident_desc">
                                        {note.description}
                                    </div>
                                    {note &&
                                        note.message &&
                                        note.message.length > 0 &&
                                        Object.keys(
                                            formatMsg(note.message)
                                        ).map(key => {
                                            return (
                                                <div className="new-mb-12">
                                                    <div className="items_dis">
                                                        <div className="incident-info">
                                                            <span className="list_k">
                                                                {key}
                                                            </span>
                                                            -{' '}
                                                        </div>
                                                        <div className="list_items">
                                                            {formatMsg(
                                                                note.message
                                                            )[key].map(
                                                                (item, i) => {
                                                                    return (
                                                                        <div
                                                                            className="incident-brief"
                                                                            key={
                                                                                i
                                                                            }
                                                                        >
                                                                            {formatMsg(
                                                                                note.message
                                                                            )[
                                                                                key
                                                                            ]
                                                                                .length >
                                                                                1 && (
                                                                                <span className="big_dot">
                                                                                    &#9679;
                                                                                </span>
                                                                            )}
                                                                            {
                                                                                item.content
                                                                            }
                                                                        </div>
                                                                    );
                                                                }
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="incident-date">
                                                        <span>
                                                            {formatMsg(
                                                                note.message
                                                            )[key].map(
                                                                (time, i) => {
                                                                    return (
                                                                        <>
                                                                            {i ===
                                                                                0 && (
                                                                                <div
                                                                                    key={
                                                                                        i
                                                                                    }
                                                                                >
                                                                                    {moment(
                                                                                        time.createdAt
                                                                                    ).format(
                                                                                        'LLL'
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </>
                                                                    );
                                                                }
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </>
                            ) : (
                                <div>No incident reported</div>
                            )}
                        </div>
                    );
                })
            ) : (
                <div className="no_monitor">
                    A monitor is required to view incident logs
                </div>
            );
        } else {
            if (this.props.noteData && this.props.noteData.requesting) {
                return (
                    <div
                        className="twitter-feed white box"
                        style={{ overflow: 'visible', ...contentBackground }}
                    >
                        <div
                            className="messages"
                            style={{ position: 'relative' }}
                        >
                            <ShouldRender
                                if={
                                    this.props.noteData &&
                                    !this.props.noteData.error
                                }
                            >
                                <div
                                    className="box-inner"
                                    style={{
                                        paddingLeft: 0,
                                        paddingRight: 0,
                                        width: '100%',
                                    }}
                                >
                                    <div className="feed-header">
                                        <ShouldRender
                                            if={!this.props.individualnote}
                                        >
                                            <span
                                                className="feed-title"
                                                style={subheading}
                                            >
                                                Incidents
                                            </span>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={this.props.individualnote}
                                        >
                                            <span
                                                className="feed-title"
                                                style={primaryTextColor}
                                            >
                                                Incidents for{' '}
                                                {this.props.individualnote
                                                    ? this.props.individualnote
                                                          .name
                                                    : ''}{' '}
                                                on{' '}
                                                {this.props.individualnote
                                                    ? moment(
                                                          this.props
                                                              .individualnote
                                                              .date
                                                      ).format('LL')
                                                    : ''}
                                            </span>
                                        </ShouldRender>
                                    </div>
                                    <ShouldRender
                                        if={
                                            this.props.noteData &&
                                            this.props.noteData.requesting
                                        }
                                    >
                                        <div
                                            className="ball-beat"
                                            id="notes-loader"
                                            style={{ marginBottom: 0 }}
                                        >
                                            <div
                                                style={{
                                                    height: '12px',
                                                    width: '12px',
                                                }}
                                            ></div>
                                            <div
                                                style={{
                                                    height: '12px',
                                                    width: '12px',
                                                }}
                                            ></div>
                                            <div
                                                style={{
                                                    height: '12px',
                                                    width: '12px',
                                                }}
                                            ></div>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </ShouldRender>
                        </div>
                    </div>
                );
            }

            return this.props.noteData ||
                this.props.individualnote ||
                this.props.showIncidentCardState ? (
                <div
                    className="twitter-feed white box"
                    style={{
                        overflow: 'visible',
                        marginBottom: 40,
                        ...contentBackground,
                    }}
                    id="incidentCard"
                >
                    <div className="messages" style={{ position: 'relative' }}>
                        <div
                            className="box-inner"
                            style={{
                                paddingLeft: 0,
                                paddingRight: 0,
                                width: '100%',
                            }}
                        >
                            <div className="feed-header">
                                <ShouldRender if={!this.props.individualnote}>
                                    <span
                                        className="feed-title"
                                        style={subheading}
                                    >
                                        Incidents
                                    </span>
                                </ShouldRender>
                                <ShouldRender if={this.props.individualnote}>
                                    <span
                                        className="feed-title"
                                        style={primaryTextColor}
                                    >
                                        Incidents for{' '}
                                        {this.props.individualnote
                                            ? this.props.individualnote.name
                                            : ''}{' '}
                                        on{' '}
                                        {this.props.individualnote
                                            ? moment(
                                                  this.props.individualnote.date
                                              ).format('LL')
                                            : ''}
                                    </span>
                                </ShouldRender>
                                <ShouldRender
                                    if={
                                        this.props.isSubscriberEnabled ===
                                            true && showSubscriberOption
                                    }
                                >
                                    <button
                                        className="bs-Button-subscribe"
                                        type="submit"
                                        onClick={() => this.subscribebutton()}
                                    >
                                        <span>Subscribe</span>
                                    </button>
                                </ShouldRender>
                            </div>
                            <ShouldRender
                                if={
                                    this.props.subscribed &&
                                    showSubscriberOption
                                }
                            >
                                <SubscribeBox />
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    this.props.noteData &&
                                    !this.props.noteData.requesting &&
                                    this.props.noteData.notes &&
                                    this.props.noteData.notes.length
                                }
                            >
                                <ul className="feed-contents plain">{note}</ul>
                            </ShouldRender>

                            <ShouldRender
                                if={
                                    (this.props.noteData &&
                                        !this.props.noteData.requesting &&
                                        this.props.noteData.notes &&
                                        !this.props.noteData.notes.length) ||
                                    (this.props.showIncidentCardState &&
                                        !this.props.noteData.notes.length)
                                }
                            >
                                <ul className="feed-contents plain">
                                    <li
                                        className="feed-item clearfix"
                                        style={{
                                            minHeight: '5px',
                                            marginBottom: '10px',
                                            display: 'flex',
                                            flexDirection: 'row',
                                            flexWrap: 'nowrap',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <span
                                            className="time"
                                            style={{
                                                fontSize: '0.8em',
                                                marginLeft: '0px',
                                                ...secondaryTextColor,
                                            }}
                                        >
                                            {this.props.notesmessage
                                                ? this.props.notesmessage
                                                : 'No incidents yet'}
                                            .
                                        </span>
                                    </li>
                                </ul>
                            </ShouldRender>
                        </div>

                        <ShouldRender
                            if={
                                this.props.noteData &&
                                this.props.noteData.notes &&
                                this.props.noteData.notes.length &&
                                this.props.count > this.props.skip + 5 &&
                                !this.props.noteData.requesting &&
                                !this.props.requestingmore &&
                                !this.props.noteData.error &&
                                !this.props.individualnote &&
                                !this.props.fetchingIncidentTimelines
                            }
                        >
                            <button
                                className="more button-as-anchor anchor-centered"
                                onClick={() => this.more()}
                            >
                                More
                            </button>
                        </ShouldRender>

                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                            }}
                        >
                            <ShouldRender
                                if={
                                    this.props.noteData &&
                                    !this.props.noteData.error &&
                                    !this.props.noteData.requesting &&
                                    this.props.individualnote
                                }
                            >
                                <button
                                    className="all__btn"
                                    onClick={() => this.getAll()}
                                >
                                    All Incidents
                                </button>
                            </ShouldRender>
                        </div>

                        <ShouldRender
                            if={
                                this.props.noteData &&
                                this.props.noteData.requesting
                            }
                        >
                            <div className="ball-beat" id="notes-loader">
                                <div
                                    style={{ height: '12px', width: '12px' }}
                                ></div>
                                <div
                                    style={{ height: '12px', width: '12px' }}
                                ></div>
                                <div
                                    style={{ height: '12px', width: '12px' }}
                                ></div>
                            </div>
                        </ShouldRender>

                        <ShouldRender
                            if={
                                this.props.noteData && this.props.requestingmore
                            }
                        >
                            <div className="ball-beat" id="more-loader">
                                <div
                                    style={{ height: '8px', width: '8px' }}
                                ></div>
                                <div
                                    style={{ height: '8px', width: '8px' }}
                                ></div>
                                <div
                                    style={{ height: '8px', width: '8px' }}
                                ></div>
                            </div>
                        </ShouldRender>
                    </div>
                </div>
            ) : null;
        }
    }
}

NotesMain.displayName = 'NotesMain';

const mapStateToProps = state => {
    let skip =
        state.status.notes && state.status.notes.skip
            ? state.status.notes.skip
            : 0;
    let count =
        state.status.notes && state.status.notes.count
            ? state.status.notes.count
            : 0;
    if (typeof skip === 'string') {
        skip = parseInt(skip, 10);
    }
    if (typeof count === 'string') {
        count = parseInt(count, 10);
    }

    return {
        noteData: state.status.notes,
        requestingmore: state.status.requestingmore,
        individualnote: state.status.individualnote,
        notesmessage: state.status.notesmessage,
        subscribed: state.subscribe.subscribeMenu,
        skip,
        count,
        isSubscriberEnabled: state.status.statusPage.isSubscriberEnabled,
        statusPage: state.status.statusPage,
        lastIncidentTimelines: state.status.lastIncidentTimelines.timelines,
        fetchingIncidentTimelines:
            state.status.lastIncidentTimelines.requesting,
        showIncidentCardState: state.status.showIncidentCard,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getStatusPageNote,
            getStatusPageIndividualNote,
            getMoreNote,
            openSubscribeMenu,
            fetchLastIncidentTimelines,
            showIncidentCard,
        },
        dispatch
    );

NotesMain.propTypes = {
    noteData: PropTypes.object,
    notesmessage: PropTypes.string,
    individualnote: PropTypes.object,
    getStatusPageNote: PropTypes.func,
    getStatusPageIndividualNote: PropTypes.func,
    getMoreNote: PropTypes.func,
    requestingmore: PropTypes.bool,
    projectId: PropTypes.string,
    openSubscribeMenu: PropTypes.func,
    subscribed: PropTypes.bool,
    skip: PropTypes.number,
    count: PropTypes.number,
    statusPageId: PropTypes.string,
    isSubscriberEnabled: PropTypes.bool.isRequired,
    statusPage: PropTypes.object,
    fetchLastIncidentTimelines: PropTypes.func,
    lastIncidentTimelines: PropTypes.array,
    fetchingIncidentTimelines: PropTypes.bool,
    showIncidentCard: PropTypes.func,
    showIncidentCardState: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(NotesMain);
