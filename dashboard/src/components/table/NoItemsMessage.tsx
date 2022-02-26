import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';

export default class NoItemsMessage extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isLoading' does not exist on type 'Reado... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
NoItemsMessage.propTypes = {
    isLoading: PropTypes.bool.isRequired,
    itemsCount: PropTypes.number,
    noItemsMessage: PropTypes.string,
};
