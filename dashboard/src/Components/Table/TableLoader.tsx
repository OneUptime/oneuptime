import React, { Component } from 'react';

import { ListLoader } from '../basic/Loader';
import PropTypes from 'prop-types';

export interface ComponentProps {
    isLoading?: boolean;
}

export default class TableLoader extends Component<TableLoaderProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
    }

    override render() {

        const { isLoading } = this.props;

        return <div>{isLoading ? <ListLoader /> : null}</div>;
    }
}


TableLoader.propTypes = {
    isLoading: PropTypes.bool,
};
