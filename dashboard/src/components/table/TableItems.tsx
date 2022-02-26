import React, { Component } from 'react';
import TableItem from './TableItem';
import PropTypes from 'prop-types';

export default class TableItems extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'items' does not exist on type 'Readonly<... Remove this comment to see the full error message
            items,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'columns' does not exist on type 'Readonl... Remove this comment to see the full error message
            columns,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'id' does not exist on type 'Readonly<{}>... Remove this comment to see the full error message
            id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClickTableRow' does not exist on type ... Remove this comment to see the full error message
            onClickTableRow,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'actionButtons' does not exist on type 'R... Remove this comment to see the full error message
            actionButtons,
        } = this.props;

        return (
            <tbody id={id}>
                {items.map((item: $TSFixMe, i: $TSFixMe) => {
                    return (
                        <TableItem
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ onClick: any; key: any; item: any; columns... Remove this comment to see the full error message
                            onClick={onClickTableRow}
                            key={i}
                            item={item}
                            columns={columns}
                            actionButtons={actionButtons}
                        />
                    );
                })}
            </tbody>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TableItems.propTypes = {
    columns: PropTypes.array.isRequired,
    items: PropTypes.array.isRequired,
    id: PropTypes.string,
    onClickTableRow: PropTypes.func,
    actionButtons: PropTypes.array,
};
