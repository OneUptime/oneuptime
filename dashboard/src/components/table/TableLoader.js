import React, { Component } from 'react';

import { ListLoader } from '../basic/Loader';

export default class TableLoader extends Component {

    constructor(props) {
        super(props);
    }

    render() {
        const { isLoading } = this.props;

        return (<div>
            {isLoading ? <ListLoader /> : null}
        </div>
        )
    }
}
