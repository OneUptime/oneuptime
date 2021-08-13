import React from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
const Twitter = ({ tweets, theme, loading }) => {
    const TweetLayout =
        theme && theme === 'Classic Theme' ? (
            <div
                id="scheduledEvents"
                className="twitter-feed white box"
                style={{ overflow: 'visible' }}
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
                        <div
                            style={{ display: 'block' }}
                            className="feed-header"
                        >
                            <span className="feed-title">Twitter Updates</span>
                            <span className="feed-title">
                                <span className="feed-icon"></span>
                            </span>

                            {loading ? (
                                <p>Loading Tweets...</p>
                            ) : tweets?.length === 0 ? (
                                <p>No tweets at this time</p>
                            ) : (
                                <ul className="feed-contents plain">
                                    {tweets?.length &&
                                        tweets.map((tweet, i) =>
                                            TweetList(tweet, i)
                                        )}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        ) : (
            <>
                <div style={{ marginBottom: '10px' }} className="font-largest">
                    Twitter
                </div>
                <div>
                    <div
                        className="box-inner"
                        style={{
                            paddingLeft: 0,
                            paddingRight: 0,
                            width: '100%',
                        }}
                    >
                        {loading ? (
                            <p>Loading Tweets...</p>
                        ) : tweets?.length === 0 ? (
                            <p>No tweets at this time</p>
                        ) : (
                            <ul className="feed-contents plain">
                                {tweets?.length &&
                                    tweets.map((tweet, i) =>
                                        TweetList(tweet, i)
                                    )}
                            </ul>
                        )}
                    </div>
                </div>
            </>
        );

    return TweetLayout;
};

Twitter.displayName = 'Twitter';

Twitter.PropTypes = {
    tweets: PropTypes.array,
    theme: PropTypes.string,
    loading: PropTypes.bool,
};

export default Twitter;

const TweetList = (tweet, index) => {
    return (
        <li
            style={{
                margin: '0 0 20px',
                cursor: 'text',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
            }}
            key={index}
        >
            <span className="feed-icon" style={{ width: '5%' }}></span>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: '90%',
                }}
            >
                <div
                    className="incidentlist feed-item clearfix"
                    style={{
                        marginBottom: 0,
                        borderTopLeftRadius: 0,
                        marginLeft: 0,
                        marginRight: 0,
                    }}
                >
                    <p className="ct_desc">{tweet.text}</p>
                </div>
                <span className="twitterTime">
                    {moment(tweet.created_at).format(
                        'dddd, MMMM Do YYYY, h:mm a'
                    )}
                </span>
            </div>
        </li>
    );
};

TweetList.displayName = ' TweetList';

TweetList.PropTypes = {
    tweet: PropTypes.string,
    index: PropTypes.string,
};
