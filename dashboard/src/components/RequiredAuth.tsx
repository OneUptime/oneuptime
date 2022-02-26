import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { User } from '../config';
import { history } from '../store';

export default function(ComposedComponent: $TSFixMe) {
    class Authentication extends Component {
        isAuthenticated: $TSFixMe;
        constructor(props: $TSFixMe) {
            super(props);
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
            this.props = props;

            this.isAuthenticated = User.isLoggedIn();
        }

        componentDidMount() {
            if (!this.isAuthenticated) {
                history.push('/login', {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
                    continue: this.props.location.pathname,
                });
            }
        }

        componentDidUpdate() {
            if (!this.isAuthenticated) {
                history.push('/login', {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
                    continue: this.props.location.pathname,
                });
            }
        }

        PropTypes = {
            router: PropTypes.object,
        };

        render() {
            return <ComposedComponent {...this.props} />;
        }
    }

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
    Authentication.propTypes = {
        location: PropTypes.object,
    };

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
    Authentication.displayName = 'RequireAuth';

    function mapStateToProps() {
        return {};
    }

    function mapDispatchToProps() {
        return {};
    }

    return connect(mapStateToProps, mapDispatchToProps)(Authentication);
}
