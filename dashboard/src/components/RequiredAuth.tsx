import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { User } from '../config';
import { history } from '../store';

export default function (ComposedComponent: $TSFixMe) {
    class Authentication extends Component {
        isAuthenticated: $TSFixMe;
        constructor(props: $TSFixMe) {
            super(props);

            this.props = props;

            this.isAuthenticated = User.isLoggedIn();
        }

        componentDidMount() {
            if (!this.isAuthenticated) {
                history.push('/login', {

                    continue: this.props.location.pathname,
                });
            }
        }

        componentDidUpdate() {
            if (!this.isAuthenticated) {
                history.push('/login', {

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


    Authentication.propTypes = {
        location: PropTypes.object,
    };


    Authentication.displayName = 'RequireAuth';

    function mapStateToProps() {
        return {};
    }

    function mapDispatchToProps() {
        return {};
    }

    return connect(mapStateToProps, mapDispatchToProps)(Authentication);
}
