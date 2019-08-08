import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import UserSetting from '../components/user/UserSetting';


class User extends Component {

    componentDidMount() {
        if(window.location.href.indexOf('localhost') <= -1){
        this.context.mixpanel.track('User page Loaded');
        }
    }

    render() {
        return (
            <Dashboard>
                <div className="db-World-contentPane Box-root Padding-bottom--48">

                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span data-reactroot="">
                                        <div>
                                            <div>
                                                <div className="Box-root Margin-bottom--12">
                                                    <UserSetting {...this.props} />
                                                </div>
                                            </div>
                                    </div>
                                </span>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
            </Dashboard>
        );
    }
}

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ destroy }, dispatch)
}

const mapStateToProps = state => {
    return {
    };
}

User.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

User.propTypes = {
}

User.displayName = 'User'

export default connect(mapStateToProps, mapDispatchToProps)(User);
