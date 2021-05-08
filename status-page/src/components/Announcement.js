import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { getAnnouncements } from '../actions/status';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { handleResources } from '../config';
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
        const { announcement, monitorState } = this.props;
        return (
            <>
                {announcement && (
                    <>
                        {this.props.theme ? (
                            <div
                                className="clean_ann"
                                onClick={e => {
                                    e.preventDefault();
                                    this.handleRouting(announcement.slug);
                                }}
                            >
                                <AnnouncementBox
                                    announcement={announcement}
                                    monitorState={monitorState}
                                />
                            </div>
                        ) : (
                            <div
                                className="announcement_classic"
                                onClick={e => {
                                    e.preventDefault();
                                    this.handleRouting(announcement.slug);
                                }}
                            >
                                <AnnouncementBox
                                    announcement={announcement}
                                    monitorState={monitorState}
                                />
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
    getAnnouncements: PropTypes.func,
    statusPage: PropTypes.object,
    announcement: PropTypes.object,
    monitorState: PropTypes.array,
    history: PropTypes.object,
};

const mapStateToProps = state => {
    return {
        statusPage: state.status.statusPage,
        announcement:
            state.status.announcements.list.allAnnouncements &&
            state.status.announcements.list.allAnnouncements.length > 0 &&
            state.status.announcements.list.allAnnouncements[0],
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getAnnouncements }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(Announcement);

function AnnouncementBox({ announcement, monitorState }) {
    return (
        <>
            <span className="ann_header">Announcement</span>
            <div className="icon_ann">
                <div className="announcement_icon">
                    <svg
                        id="Capa_1"
                        fill="#fff"
                        enableBackground="new 0 0 512 512"
                        height="20"
                        viewBox="0 0 512 512"
                        width="20"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <g>
                            <path d="m423.576 187.702c-3.706-7.412-.703-16.421 6.709-20.127l60-30c7.412-3.691 16.421-.703 20.127 6.709s.703 16.421-6.709 20.127l-60 30c-7.487 3.719-16.439.646-20.127-6.709z" />
                            <path d="m490.285 344.411-60-30c-7.412-3.706-10.415-12.715-6.709-20.127 3.735-7.397 12.715-10.371 20.127-6.709l60 30c7.412 3.706 10.415 12.715 6.709 20.127-3.691 7.362-12.647 10.424-20.127 6.709z" />
                            <path d="m496.994 255.994h-60c-8.291 0-15-6.709-15-15s6.709-15 15-15h60c8.291 0 15 6.709 15 15s-6.709 15-15 15z" />
                            <path d="m377 61c-8.291 0-15 6.709-15 15v21.418c-54.229 34.717-118.104 57.162-182 64.891v157.383c63.896 7.729 127.771 30.174 182 64.891v21.417c0 8.291 6.709 15 15 15s15-6.709 15-15v-330c0-8.291-6.709-15-15-15z" />
                            <path d="m145.386 423.695c-13.812-24.862-25.743-54.064-16.553-79.761l-74.077-8.247c-5.57-.617-10.933-1.818-16.15-3.333-11.027 31.934-10.029 63.353-9.075 86.858.235 6.021.469 11.646.469 16.788 0 8.291 6.709 15 15 15h90c5.2 0 10.034-2.695 12.759-7.119 2.739-4.424 2.988-9.946.659-14.59z" />
                            <path d="m0 241c0 33.311 24.961 61.201 58.066 64.878l91.934 10.223v-150.202l-91.934 10.223c-33.105 3.677-58.066 31.567-58.066 64.878z" />
                        </g>
                    </svg>
                </div>
                <div className="ann_title">{announcement.name}</div>
            </div>
            <div className="ann_desc">{announcement.description}</div>
            <div className="resources_aff">
                <span>Resources Affected: </span>
                <span>
                    {announcement &&
                        handleResources(monitorState, announcement)}
                </span>
            </div>
        </>
    );
}

AnnouncementBox.propTypes = {
    announcement: PropTypes.object,
    monitorState: PropTypes.array,
};

AnnouncementBox.displayName = 'AnnouncementBox';
