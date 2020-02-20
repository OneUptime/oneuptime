import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import Notes from './Notes';
import ShouldRender from './ShouldRender';
import SubscribeBox from './Subscribe/SubscribeBox';
import { getStatusPageNote, getStatusPageIndividualNote, getMoreNote } from '../actions/status';
import { openSubscribeMenu } from '../actions/subscribe';

class NotesMain extends Component {
    constructor(props) {
        super(props);

        this.getAll = this.getAll.bind(this);
        this.more = this.more.bind(this);
        this.subscribebutton = this.subscribebutton.bind(this);
    }

    componentDidMount() {
        this.props.getStatusPageNote(this.props.projectId, this.props.statusPageId, 0);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.statusPage !== this.props.statusPage) {
            if (this.props.individualnote) {
                this.props.getStatusPageIndividualNote(this.props.projectId, this.props.individualnote._id, this.props.individualnote.date, this.props.individualnote.name, true);
            } else {
                this.props.getStatusPageNote(this.props.projectId, this.props.statusPageId, 0);
            }
        }
    }

    getAll = () => {
        this.props.getStatusPageNote(this.props.projectId, this.props.statusPageId, 0);
    }

    more = () => {
        this.props.getMoreNote(this.props.projectId, this.props.statusPageId, (this.props.skip + 5));
    }

    subscribebutton = () => {
        this.props.openSubscribeMenu();
    }

    render() {
        let note = '';
        let contentBackground, primaryTextColor, secondaryTextColor, downtimeColor, uptimeColor, degradedColor, noteBackgroundColor;
        const subheading = {};
        if (this.props.statusPage) {
            const colors = this.props.statusPage.colors
            contentBackground = {
				background: `rgba(${colors.statusPageBackground.r}, ${colors.statusPageBackground.g}, ${colors.statusPageBackground.b}, ${colors.statusPageBackground.a})`
            };
            subheading.color = `rgba(${colors.subheading.r}, ${colors.subheading.g}, ${colors.subheading.b}, ${colors.subheading.a})`;
            primaryTextColor = {
				color: `rgba(${colors.primaryText.r}, ${colors.primaryText.g}, ${colors.primaryText.b}, ${colors.primaryText.a})`
			};
            secondaryTextColor = {
				color: `rgba(${colors.secondaryText.r}, ${colors.secondaryText.g}, ${colors.secondaryText.b}, ${colors.secondaryText.a})`
            };
            downtimeColor = {
				backgroundColor: `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b})`
			};
			uptimeColor = {
				backgroundColor: `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b})`
			};
			degradedColor = {
				backgroundColor: `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b})`
			};
			noteBackgroundColor = {
				background: `rgba(${colors.noteBackground.r}, ${colors.noteBackground.g}, ${colors.noteBackground.b})`
			};
        }
        if (this.props.noteData && this.props.noteData.notes) {
            note = <Notes
                        notes={this.props.noteData.notes}
                        secondaryTextColor={secondaryTextColor}
                        primaryTextColor={primaryTextColor}
                        downtimeColor={downtimeColor}
                        uptimeColor={uptimeColor}
                        degradedColor={degradedColor}
                        noteBackgroundColor={noteBackgroundColor}
                    />;
        }
        const { enableRSSFeed, smsNotification, webhookNotification, emailNotification } = this.props.statusPage;
        const showSubscriberOption = enableRSSFeed || smsNotification || webhookNotification || emailNotification;

        return (
            <div className="twitter-feed white box" style={{ overflow: 'visible', ...contentBackground }}>
                <div className="messages" style={{ position: 'relative' }}>

                    <ShouldRender if={this.props.noteData && !this.props.noteData.error}>
                        <div className="box-inner">

                            <div className="feed-header clearfix" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' }}>
                                <ShouldRender if={!this.props.individualnote}>
                                    <span className="feed-title" style={subheading}>Past Incidents</span>
                                </ShouldRender>
                                <ShouldRender if={this.props.individualnote}>
                                    <span className="feed-title" style={primaryTextColor}>Incidents for {this.props.individualnote ? this.props.individualnote.name : ''} on {this.props.individualnote ? moment(this.props.individualnote.date).format('LL') : ''}</span>
                                </ShouldRender>
                                <ShouldRender if={this.props.isSubscriberEnabled === true && showSubscriberOption}>
                                    <button className="bs-Button-subscribe" type="submit" onClick={() => this.subscribebutton()} style={{ marginLeft: 'auto', marginRight: '18px', marginTop: '-8px' }}><span>Subscribe</span></button>
                                </ShouldRender>
                            </div>
                            <ShouldRender if={this.props.subscribed && showSubscriberOption}>
                                <SubscribeBox />
                            </ShouldRender>
                            <ShouldRender if={this.props.noteData && !this.props.noteData.requesting && this.props.noteData.notes && this.props.noteData.notes.length}>
                                <ul className="feed-contents plain">
                                    {note}
                                </ul>
                            </ShouldRender>

                            <ShouldRender if={this.props.noteData && !this.props.noteData.requesting && this.props.noteData.notes && !this.props.noteData.notes.length}>
                                <ul className="feed-contents plain">
                                    <li
                                        className="feed-item clearfix"
                                        style={{
                                            minHeight: '5px',
                                            marginBottom: '10px',
                                            display: 'flex',
                                            flexDirection: 'row',
                                            flexWrap: 'nowrap',
                                            justifyContent: 'center'
                                        }}
                                    >
                                        <span
                                            className="time"
                                            style={{
                                                fontSize: '0.8em',
                                                marginLeft: '0px',
                                                ...secondaryTextColor
                                            }}>
                                            {this.props.notesmessage ? this.props.notesmessage : 'No incidents yet'}.
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
                                this.props.count > (this.props.skip + 5) &&
                                !this.props.noteData.requesting &&
                                !this.props.requestingmore &&
                                !this.props.noteData.error &&
                                !this.props.individualnote
                            }
                        >
                            <button className="more button-as-anchor" onClick={() => this.more()}>More</button>
                        </ShouldRender>

                        <ShouldRender
                            if={
                                this.props.noteData &&
                                !this.props.noteData.error &&
                                !this.props.noteData.requesting &&
                                this.props.individualnote
                            }
                        >
                            <button className="more button-as-anchor" onClick={() => this.getAll()}>Get all incidents</button>
                        </ShouldRender>

                        <ShouldRender if={this.props.noteData && this.props.noteData.requesting}>
                            <div className="ball-beat" id="notes-loader">
                                <div style={{ height: '12px', width: '12px' }}></div>
                                <div style={{ height: '12px', width: '12px' }}></div>
                                <div style={{ height: '12px', width: '12px' }}></div>
                            </div>
                        </ShouldRender>

                        <ShouldRender if={this.props.noteData && this.props.requestingmore}>
                            <div className="ball-beat" id="more-loader">
                                <div style={{ height: '8px', width: '8px' }}></div>
                                <div style={{ height: '8px', width: '8px' }}></div>
                                <div style={{ height: '8px', width: '8px' }}></div>
                            </div>
                        </ShouldRender>

                    </ShouldRender>

                </div>
            </div>
        );
    }
}

NotesMain.displayName = 'NotesMain';

const mapStateToProps = (state) => {
    let skip = state.status.notes && state.status.notes.skip ? state.status.notes.skip : 0;
    let count = state.status.notes && state.status.notes.count ? state.status.notes.count : 0;
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
        statusPage: state.status.statusPage
    }
};

const mapDispatchToProps = (dispatch) => bindActionCreators({
    getStatusPageNote,
    getStatusPageIndividualNote,
    getMoreNote,
    openSubscribeMenu
}, dispatch);

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
    statusPage: PropTypes.object
};

export default connect(mapStateToProps, mapDispatchToProps)(NotesMain);