import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import Events from './Events';
import ShouldRender from './ShouldRender';
import {
    getScheduledEvent,
    getIndividualEvent,
    getMoreEvent,
} from '../actions/status';

class EventsMain extends Component {
    constructor(props) {
        super(props);

        this.getAll = this.getAll.bind(this);
        this.more = this.more.bind(this);
    }

    componentDidMount() {
        this.props.getScheduledEvent(
            this.props.projectId,
            this.props.statusPageId,
            0
        );
    }

    componentDidUpdate(prevProps) {
        if (prevProps.statusPage !== this.props.statusPage) {
            if (this.props.individualevent) {
                this.props.getIndividualEvent(
                    this.props.projectId,
                    this.props.individualevent._id,
                    this.props.individualevent.date,
                    this.props.individualevent.name,
                    true
                );
            } else {
                this.props.getScheduledEvent(
                    this.props.projectId,
                    this.props.statusPageId,
                    0
                );
            }
        }
    }

    getAll = () => {
        this.props.getScheduledEvent(
            this.props.projectId,
            this.props.statusPageId,
            0
        );
    };

    more = () => {
        this.props.getMoreEvent(
            this.props.projectId,
            this.props.statusPageId,
            this.props.skip + 5
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
        if (this.props.eventData && this.props.eventData.events) {
            event = (
                <Events
                    events={this.props.eventData.events}
                    secondaryTextColor={secondaryTextColor}
                    primaryTextColor={primaryTextColor}
                    noteBackgroundColor={noteBackgroundColor}
                />
            );
        }

        return (
            <div
                className="twitter-feed white box"
                style={{ overflow: 'visible', ...contentBackground }}
            >
                <div className="messages" style={{ position: 'relative' }}>
                    <ShouldRender
                        if={this.props.eventData && !this.props.eventData.error}
                    >
                        <div className="box-inner">
                            <div
                                className="feed-header clearfix"
                                style={{
                                    display: 'flex',
                                    flexDirection: 'row',
                                    flexWrap: 'nowrap',
                                }}
                            >
                                <ShouldRender if={!this.props.individualevent}>
                                    <span
                                        className="feed-title"
                                        style={subheading}
                                    >
                                        Scheduled Events
                                    </span>
                                </ShouldRender>
                                <ShouldRender if={this.props.individualevent}>
                                    <span
                                        className="feed-title"
                                        style={primaryTextColor}
                                    >
                                        Scheduled Events for{' '}
                                        {this.props.individualevent
                                            ? this.props.individualevent.name
                                            : ''}{' '}
                                        on{' '}
                                        {this.props.individualevent
                                            ? moment(
                                                  this.props.individualevent
                                                      .date
                                              ).format('LL')
                                            : ''}
                                    </span>
                                </ShouldRender>
                            </div>
                            <ShouldRender
                                if={
                                    this.props.eventData &&
                                    !this.props.eventData.requesting &&
                                    this.props.eventData.events &&
                                    this.props.eventData.events.length
                                }
                            >
                                <ul className="feed-contents plain">{event}</ul>
                            </ShouldRender>

                            <ShouldRender
                                if={
                                    this.props.eventData &&
                                    !this.props.eventData.requesting &&
                                    this.props.eventData.events &&
                                    !this.props.eventData.events.length
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
                                            {this.props.eventsmessage
                                                ? this.props.eventsmessage
                                                : 'No scheduled events yet'}
                                            .
                                        </span>
                                    </li>
                                </ul>
                            </ShouldRender>
                        </div>

                        <ShouldRender
                            if={
                                this.props.eventData &&
                                this.props.eventData.events &&
                                this.props.eventData.events.length &&
                                this.props.count > this.props.skip + 5 &&
                                !this.props.eventData.requesting &&
                                !this.props.requestingmoreevents &&
                                !this.props.eventData.error &&
                                !this.props.individualevent
                            }
                        >
                            <button
                                className="more button-as-anchor anchor-centered"
                                onClick={() => this.more()}
                            >
                                More
                            </button>
                        </ShouldRender>

                        <ShouldRender
                            if={
                                this.props.eventData &&
                                !this.props.eventData.error &&
                                !this.props.eventData.requesting &&
                                this.props.individualevent
                            }
                        >
                            <button
                                className="more button-as-anchor anchor-centered"
                                onClick={() => this.getAll()}
                            >
                                Get all scheduled events
                            </button>
                        </ShouldRender>

                        <ShouldRender
                            if={
                                this.props.eventData &&
                                this.props.eventData.requesting
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
                                this.props.eventData &&
                                this.props.requestingmoreevents
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
                    </ShouldRender>
                </div>
            </div>
        );
    }
}

EventsMain.displayName = 'EventsMain';

const mapStateToProps = state => {
    let skip =
        state.status.events && state.status.events.skip
            ? state.status.events.skip
            : 0;
    let count =
        state.status.events && state.status.events.count
            ? state.status.events.count
            : 0;
    if (typeof skip === 'string') {
        skip = parseInt(skip, 10);
    }
    if (typeof count === 'string') {
        count = parseInt(count, 10);
    }

    return {
        eventData: state.status.events,
        requestingmoreevents: state.status.requestingmoreevents,
        individualevent: state.status.individualevent,
        eventsmessage: state.status.eventsmessage,
        skip,
        count,
        statusPage: state.status.statusPage,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getScheduledEvent,
            getIndividualEvent,
            getMoreEvent,
        },
        dispatch
    );

EventsMain.propTypes = {
    eventData: PropTypes.object,
    eventsmessage: PropTypes.string,
    individualevent: PropTypes.object,
    getScheduledEvent: PropTypes.func,
    getIndividualEvent: PropTypes.func,
    getMoreEvent: PropTypes.func,
    requestingmoreevents: PropTypes.bool,
    projectId: PropTypes.string,
    skip: PropTypes.number,
    count: PropTypes.number,
    statusPageId: PropTypes.string,
    statusPage: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(EventsMain);
