import React, { Component } from 'react';

import { ListLoader } from '../basic/Loader';
import PropTypes from 'prop-types';

interface TableLoaderProps {
    isLoading?: boolean;
}

export default class TableLoader extends Component<TableLoaderProps> {
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
