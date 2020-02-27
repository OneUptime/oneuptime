import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { switchProject } from '../actions/project';
import { connect } from 'react-redux';

const mapStateToProps = state => ({
    project: state.project,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            switchProject,
            dispatch,
        },
        dispatch
    );

class ConnectToStore extends React.Component {
    componentDidMount() {
        this.props.switchProject(this.props.dispatch, {
            _id: '5b1f39482a62c8611d23c953',
            users: [
                {
                    userId: '5b1c0c29cb06cc23b132db07',
                    role: 'Administrator',
                    _id: '5b1f39482a62c8611d23c954',
                },
                {
                    userId: '5b1d20232352d77c91b2dae1',
                    role: 'Member',
                    _id: '5b2c77fa728c4b2bc286eca4',
                },
            ],
            createdAt: '2018-06-12T03:08:56.638Z',
            name: 'Test 1',
            apiKey: '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
            stripePlanId: 'plan_CpIUcLDhD1HKKA',
            stripeSubscriptionId: 'sub_D276mFZNBg3iMK',
            stripeMeteredSubscriptionId: 'sub_D276LWAbjABjIZ',
        });
    }
    render() {
        return null;
    }
}

ConnectToStore.propTypes = {
    switchProject: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
};

ConnectToStore.displayName = 'ConnectToStore';

const MockCurrentProject = connect(
    mapStateToProps,
    mapDispatchToProps
)(ConnectToStore);

export { MockCurrentProject };
