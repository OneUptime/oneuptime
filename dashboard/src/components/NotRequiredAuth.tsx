import React, { Component } from 'react';
import { connect } from 'react-redux';
import { User } from '../config';
import { history } from '../store';

export default function (ComposedComponent: $TSFixMe) {
    class NotAuthentication extends Component<ComponentProps> {

        public static propTypes = {};

        isAuthenticated: $TSFixMe;
        constructor(props: $TSFixMe) {
            super(props);

            this.props = props;

            this.isAuthenticated = User.isLoggedIn();
        }

        override componentDidMount() {
            if (this.isAuthenticated) {
                history.push('/dashboard/project/project/monitoring');
            }
        }

        componentDidUpdate() {
            if (this.isAuthenticated) {
                history.push('/dashboard/project/project/monitoring');
            }
        }

        override render() {
            return <ComposedComponent {...this.props} />;
        }
    }

    function mapStateToProps() {
        return {};
    }


    NotAuthentication.displayName = 'NotAuthentication';

    return connect(mapStateToProps)(NotAuthentication);
}
