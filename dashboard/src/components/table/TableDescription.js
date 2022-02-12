import React, { Component } from 'react';

export default class TableDescription extends Component {

    constructor(props) {
        super(props);
    }

    render() {
        const { description } = this.props;

        return (
            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                <span>
                    {description}{' '}
                </span>
            </span>
        )
    }
}
