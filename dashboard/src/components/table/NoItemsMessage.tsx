import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';

export default class NoItemsMessage extends Component {
    constructor(props) {
        super(props);
    }

    render() {
        const { isLoading, itemsCount, noItemsMessage } = this.props;

        return (
            <ShouldRender if={!isLoading && itemsCount === 0}>
                <div
                    className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                    style={{
                        textAlign: 'center',
                        marginTop: '20px',
                        padding: '0 10px',
                    }}
                >
                    {noItemsMessage}
                </div>
            </ShouldRender>
        );
    }
}

NoItemsMessage.propTypes = {
    isLoading: PropTypes.bool.isRequired,
    itemsCount: PropTypes.number,
    noItemsMessage: PropTypes.string,
};
