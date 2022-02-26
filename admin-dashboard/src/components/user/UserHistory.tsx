import React from 'react';
import PropTypes from 'prop-types';
import HistoryList from './HistroyList';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { fetchUserloginHistory } from '../../actions/user';

class UserHistory extends React.Component {
    constructor() {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1-2 arguments, but got 0.
        super();
        this.state = { page: 1 };
    }
    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { userId } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserloginHistory' does not exist on... Remove this comment to see the full error message
        this.props.fetchUserloginHistory(
            userId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { userId } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserloginHistory' does not exist on... Remove this comment to see the full error message
        this.props.fetchUserloginHistory(userId, skip + limit, 10);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };
    render() {
        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Login History</span>
                                    </span>
                                    <p>
                                        <span>
                                            Here is a list of all account login
                                        </span>
                                    </p>
                                </div>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div></div>
                            </div>
                        </div>
                        <HistoryList
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ history: any; prevClicked: (skip: any, lim... Remove this comment to see the full error message
                            history={this.props.history}
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}
                        />
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
UserHistory.displayName = 'UserHistory';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ fetchUserloginHistory }, dispatch);
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
UserHistory.propTypes = {
    fetchUserloginHistory: PropTypes.func.isRequired,
    userId: PropTypes.string,
    history: PropTypes.object,
};

export default connect(null, mapDispatchToProps)(UserHistory);
