import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { withRouter } from 'react-router-dom';
import { unsubscribeUser } from '../actions/subscribe';
import ShouldRender from './ShouldRender';
import { ListLoader } from './basic/Loader';

class Unsubscribe extends Component {
    componentDidMount() {
        const { monitorId, subscriberId } = this.props.match.params;
        this.props.unsubscribeUser(monitorId, subscriberId);
    }
    render() {
        const { requesting, error } = this.props.unsubscribe;
        return (
            <div className="innernew">
                <div
                    style={{
                        padding: '2px',
                        background: '#EEEEEE',
                        border: '1px solid #CCCCCC',
                        marginTop: '10px',
                        textAlign: 'center',
                    }}
                >
                    <ShouldRender if={requesting}>
                        <ListLoader />
                    </ShouldRender>
                    <ShouldRender if={!requesting && error}>
                        <p style={{ padding: 0, color: 'red' }}>{error}</p>
                    </ShouldRender>
                    <ShouldRender if={!requesting && !error}>
                        <p style={{ padding: 0 }}>
                            You have successfully unsubscribed from this monitor
                        </p>
                    </ShouldRender>
                </div>
            </div>
        );
    }
}

Unsubscribe.displayName = 'Unsubscribe';

Unsubscribe.propTypes = {
    match: PropTypes.object,
    unsubscribeUser: PropTypes.func.isRequired,
    unsubscribe: PropTypes.object,
};

function mapStateToProps(state) {
    return {
        unsubscribe: state.subscribe.unsubscribe,
    };
}

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            unsubscribeUser,
        },
        dispatch
    );

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(withRouter(Unsubscribe));
