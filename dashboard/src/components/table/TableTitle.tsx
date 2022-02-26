import React, { Component } from 'react';
import PropTypes from 'prop-types';
export default class TableTitle extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { title } = this.props;

        return (
            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                <span>{title}</span>
            </span>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TableTitle.propTypes = {
    title: PropTypes.string.isRequired,
};
