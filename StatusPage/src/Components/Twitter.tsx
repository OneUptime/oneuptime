import React from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
const Twitter: Function = ({
    tweets,
    theme,
    loading,
    error
}: $TSFixMe) => {
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

                            {loading ? (
                                <p>Loading Tweets...</p>
                            ) : tweets?.length === 0 ? (
                                <p style={{ color: 'rgb(250, 109, 70)' }}>
                                    Twitter handle not set. Go to status page
                                    advanced options to set it now.
                                </p>
                            ) : (
                                <ul
                                    className="feed-contents plain"
                                    style={{ marginTop: '35px' }}
                                >
                                    {tweets?.length &&
                                        tweets.map((tweet: $TSFixMe, i: $TSFixMe) =>
                                            TweetList(tweet, i)
                                        )}
                                </ul>
                            )}
                        </div>
                        {error && (
                            <div style={{ display: 'flex', marginLeft: 5 }}>
                                <div
                                    style={{ marginRight: 5 }}
                                    className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                ></div>
                                <span style={{ color: 'red', fontSize: 12 }}>
                                    {error}
                                </span>
                            </div>
                        )}
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
                            <p style={{ color: 'rgb(250, 109, 70)' }}>
                                Twitter handle not set. Go to status page
                                advanced options to set it now.
                            </p>
                        ) : (
                            <ul className="feed-contents plain">
                                {tweets?.length &&
                                    tweets.map((tweet: $TSFixMe, i: $TSFixMe) =>
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
    error: PropTypes.string,
};

export default Twitter;

const TweetList: Function = (tweet: $TSFixMe, index: $TSFixMe) => {
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
            <span
                className="feed-icon"
                style={{ width: '5%', marginTop: 5 }}
            ></span>
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
