import React, { Component } from 'react';
import PropTypes from 'prop-types';
export default class TableDescription extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'description' does not exist on type 'Rea... Remove this comment to see the full error message
        const { description } = this.props;

        return (
            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                <span>{description} </span>
            </span>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TableDescription.propTypes = {
    description: PropTypes.string,
};
