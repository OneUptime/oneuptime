import React, { Component } from 'react';
import { connect } from 'react-redux';
import { User } from '../config';
import { history } from '../store';

export default function(ComposedComponent: $TSFixMe) {
    class NotAuthentication extends Component {
        isAuthenticated: $TSFixMe;
        constructor(props: $TSFixMe) {
            super(props);
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
            this.props = props;

            this.isAuthenticated = User.isLoggedIn();
        }

        componentDidMount() {
            if (this.isAuthenticated) {
                history.push('/dashboard/project/project/monitoring');
            }
        }

        componentDidUpdate() {
            if (this.isAuthenticated) {
                history.push('/dashboard/project/project/monitoring');
            }
        }

        render() {
            return <ComposedComponent {...this.props} />;
        }
    }

    function mapStateToProps() {
        return {};
    }

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
    NotAuthentication.displayName = 'NotAuthentication';

    return connect(mapStateToProps)(NotAuthentication);
}
