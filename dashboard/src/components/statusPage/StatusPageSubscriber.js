import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { fetchStatusPageSubscribers } from '../../actions/statusPage';
import PropTypes from 'prop-types';

class StatusPageSubscriber extends Component {
    async componentDidMount() {
        const {
            fetchStatusPageSubscribers,
            statusPage,
            projectId,
        } = this.props;
        await fetchStatusPageSubscribers(projectId, statusPage._id);
    }
    render() {
        return <div>Hello StatusPageSubscriber</div>;
    }
}

StatusPageSubscriber.displayName = 'StatusPageSubscriber';

const mapDispatchToProps = dispatch =>
    bindActionCreators({ fetchStatusPageSubscribers }, dispatch);

StatusPageSubscriber.propTypes = {
    fetchStatusPageSubscribers: PropTypes.func,
};

export default connect(null, mapDispatchToProps)(StatusPageSubscriber);
