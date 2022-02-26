import React, { Component } from 'react';

import { ListLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
export default class TableLoader extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isLoading' does not exist on type 'Reado... Remove this comment to see the full error message
        const { isLoading } = this.props;

        return <div>{isLoading ? <ListLoader /> : null}</div>;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TableLoader.propTypes = {
    isLoading: PropTypes.bool,
};
