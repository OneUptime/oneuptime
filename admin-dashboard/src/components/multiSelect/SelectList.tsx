import React from 'react';
import PropTypes from 'prop-types';
import SelectItem from './SelectItem';

class SelectList extends React.Component {
    handleSelectionChanged = (option: $TSFixMe, checked: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'selected' does not exist on type 'Readon... Remove this comment to see the full error message
        const { selected, onSelectedChanged, disabled } = this.props;

        if (disabled) return true;

        if (checked) {
            onSelectedChanged({ selected, onSelectedChanged, disabled });
        } else {
            const index = selected.indexOf(option.value);
            const removed = [
                ...selected.slice(0, index),
                ...selected.slice(index, 1),
            ];

            onSelectedChanged(removed);
        }
    };

    renderItems() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'options' does not exist on type 'Readonl... Remove this comment to see the full error message
            options,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'selected' does not exist on type 'Readon... Remove this comment to see the full error message
            selected,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'focusIndex' does not exist on type 'Read... Remove this comment to see the full error message
            focusIndex,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClick' does not exist on type 'Readonl... Remove this comment to see the full error message
            onClick,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ItemRenderer' does not exist on type 'Re... Remove this comment to see the full error message
            ItemRenderer,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'disabled' does not exist on type 'Readon... Remove this comment to see the full error message
            disabled,
        } = this.props;
        return options.map((o: $TSFixMe, i: $TSFixMe) => (
            <li
                key={Object.prototype.hasOwnProperty.call(o, 'key') ? o.key : i}
                style={{ listStyle: 'none' }}
            >
                <SelectItem
                    // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                    focused={focusIndex === 1}
                    option={o}
                    onSelectChanged={(c: $TSFixMe) => this.handleSelectionChanged(o, c)}
                    checked={selected.includes(o.value)}
                    onClick={(e: $TSFixMe) => onClick(e, i)}
                    ItemRenderer={ItemRenderer}
                    disabled={disabled}
                />
            </li>
        ));
    }
    render() {
        return (
            <ul
                className="db-MultiSelect-select-list"
                style={{ margin: 0, paddingLeft: 0 }}
            >
                {this.renderItems()}
            </ul>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SelectList.displayName = 'SelectList';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SelectList.propTypes = {
    selected: PropTypes.arrayOf(Object).isRequired,
    options: PropTypes.arrayOf({
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ label: PropTypes.Validator<str... Remove this comment to see the full error message
        label: PropTypes.string.isRequired,
        value: PropTypes.string.isRequired,
        key: PropTypes.string,
    }),
    focusIndex: PropTypes.number.isRequired,
    onSelectedChanged: PropTypes.func,
    onClick: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
    ItemRenderer: PropTypes.element.isRequired,
};

export default SelectList;
