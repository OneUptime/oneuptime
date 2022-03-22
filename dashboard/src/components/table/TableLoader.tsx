import React, { Component } from 'react';

import { ListLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
export default class TableLoader extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {

        const { isLoading } = this.props;

        return <div>{isLoading ? <ListLoader /> : null}</div>;
    }
}


TableLoader.propTypes = {
    isLoading: PropTypes.bool,
};
