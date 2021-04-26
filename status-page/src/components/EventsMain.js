import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import Events from './Events';
import ShouldRender from './ShouldRender';
import {
    fetchMoreFutureEvents,
    fetchFutureEvents,
    showEventCard,
} from '../actions/status';

class EventsMain extends Component {
    constructor(props) {
        super(props);

        this.getAll = this.getAll.bind(this);
        this.more = this.more.bind(this);
    }

    componentDidMount() {
        this.props.fetchFutureEvents(
            this.props.projectId,
            this.props.statusPageSlug,
            0
        );
    }

    getAll = () => {
        this.props.showEventCard(true);
        this.props.fetchFutureEvents(
            this.props.projectId,
            this.props.statusPageSlug,
            0
        );
    };

    more = () => {
        this.props.fetchMoreFutureEvents(
            this.props.projectId,
            this.props.statusPageSlug,
            this.props.skip + 1
        );
    };

    render() {
        let event = '';
        let contentBackground,
            primaryTextColor,
            secondaryTextColor,
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
            noteBackgroundColor = {
                background: `rgba(${colors.noteBackground.r}, ${colors.noteBackground.g}, ${colors.noteBackground.b})`,
            };
        }
        if (this.props.futureEvents && this.props.futureEvents.events) {
            event = (
                <Events
                    events={this.props.futureEvents.events}
                    secondaryTextColor={secondaryTextColor}
                    primaryTextColor={primaryTextColor}
                    noteBackgroundColor={noteBackgroundColor}
                    statusPageId={this.props.statusPageId}
                    statusPageSlug={this.props.statusPageSlug}
                    monitorState={this.props.monitorState}
                />
            );
        }

        if (
            this.props.individualEvents.show &&
            this.props.individualEvents.events
        ) {
            event = (
                <Events
                    events={this.props.individualEvents.events}
                    secondaryTextColor={secondaryTextColor}
                    primaryTextColor={primaryTextColor}
                    noteBackgroundColor={noteBackgroundColor}
                    statusPageId={this.props.statusPageId}
                    statusPageSlug={this.props.statusPageSlug}
                    monitorState={this.props.monitorState}
                />
            );
        }

        return (!this.props.individualEvents.show &&
            this.props.futureEvents.events.length > 0) ||
            this.props.individualEvents.show ||
            this.props.showEventCardState ? (
            <div
                id="scheduledEvents"
                className="twitter-feed white box"
                style={{ overflow: 'visible', ...contentBackground }}
            >
                <div className="messages" style={{ position: 'relative' }}>
                    <ShouldRender
                        if={
                            this.props.futureEvents &&
                            !this.props.futureEvents.error
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
                                    if={!this.props.individualEvents.show}
                                >
                                    <span
                                        className="feed-title"
                                        style={subheading}
                                    >
                                        Future Scheduled Events
                                    </span>
                                </ShouldRender>
                                <ShouldRender
                                    if={this.props.individualEvents.show}
                                >
                                    <span
                                        className="feed-title"
                                        style={primaryTextColor}
                                    >
                                        Scheduled Events for{' '}
                                        {this.props.individualEvents.monitorName
                                            ? this.props.individualEvents
                                                  .monitorName
                                            : ''}{' '}
                                        on{' '}
                                        {this.props.individualEvents.date
                                            ? moment(
                                                  this.props.individualEvents
                                                      .date
                                              ).format('LL')
                                            : ''}
                                    </span>
                                </ShouldRender>
                            </div>
                            <ShouldRender
                                if={
                                    (!this.props.individualEvents.show &&
                                        this.props.futureEvents.events.length >
                                            0) ||
                                    (this.props.individualEvents.show &&
                                        this.props.individualEvents.events
                                            .length > 0)
                                }
                            >
                                <ul className="feed-contents plain">{event}</ul>
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    this.props.individualEvents.show &&
                                    this.props.individualEvents.events
                                        .length === 0
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
                                            No data available for this date.
                                        </span>
                                    </li>
                                </ul>
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    this.props.showEventCardState &&
                                    this.props.futureEvents.events.length ===
                                        0 &&
                                    this.props.individualEvents.events
                                        .length === 0
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
                                            No Scheduled Events
                                        </span>
                                    </li>
                                </ul>
                            </ShouldRender>
                        </div>

                        <ShouldRender
                            if={
                                this.props.futureEvents &&
                                this.props.futureEvents.events &&
                                this.props.futureEvents.events.length &&
                                this.props.count >
                                    this.props.futureEvents.events.length &&
                                !this.props.futureEvents.requesting &&
                                !this.props.requestingmoreevents &&
                                !this.props.futureEvents.error &&
                                !this.props.individualEvents.show
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
                                    this.props.futureEvents &&
                                    !this.props.futureEvents.error &&
                                    !this.props.futureEvents.requesting &&
                                    this.props.individualEvents.show
                                }
                            >
                                <button
                                    className="all__btn"
                                    onClick={() => this.getAll()}
                                >
                                    All Scheduled Events
                                </button>
                            </ShouldRender>
                        </div>

                        <ShouldRender
                            if={
                                this.props.futureEvents.requesting ||
                                this.props.requestingmoreevents
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
                    </ShouldRender>
                </div>
            </div>
        ) : null;
    }
}

EventsMain.displayName = 'EventsMain';

const mapStateToProps = state => {
    let skip =
        state.status.futureEvents && state.status.futureEvents.skip
            ? state.status.futureEvents.skip
            : 0;
    let count =
        state.status.futureEvents && state.status.futureEvents.count
            ? state.status.futureEvents.count
            : 0;
    if (typeof skip === 'string') {
        skip = parseInt(skip, 10);
    }
    if (typeof count === 'string') {
        count = parseInt(count, 10);
    }

    return {
        requestingmoreevents: state.status.moreFutureEvents.requesting,
        skip,
        count,
        statusPage: state.status.statusPage,
        futureEvents: state.status.futureEvents,
        individualEvents: state.status.individualEvents,
        monitorState: state.status.statusPage.monitorsData,
        showEventCardState: state.status.showEventCard,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchMoreFutureEvents,
            fetchFutureEvents,
            showEventCard,
        },
        dispatch
    );

EventsMain.propTypes = {
    fetchMoreFutureEvents: PropTypes.func,
    requestingmoreevents: PropTypes.bool,
    projectId: PropTypes.string,
    skip: PropTypes.number,
    count: PropTypes.number,
    statusPageId: PropTypes.string,
    statusPageSlug: PropTypes.string,
    statusPage: PropTypes.object,
    fetchFutureEvents: PropTypes.func,
    futureEvents: PropTypes.object,
    individualEvents: PropTypes.object,
    monitorState: PropTypes.array,
    showEventCardState: PropTypes.bool,
    showEventCard: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(EventsMain);
