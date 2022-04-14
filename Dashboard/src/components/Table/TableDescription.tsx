import React, { Component } from 'react';
import PropTypes from 'prop-types';

export interface ComponentProps {
    description?: string;
}

export default class TableDescription extends Component<TableDescriptionProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
    }

    override render() {

        const { description }: $TSFixMe = this.props;

        return (
            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                <span>{description} </span>
            </span>
        );
    }
}


TableDescription.propTypes = {
    description: PropTypes.string,
};
