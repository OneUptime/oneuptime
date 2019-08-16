import React from 'react';
import PropTypes from 'prop-types';
import SelectItem from './SelectItem';

class SelectList extends React.Component {

    handleSelectionChanged = (option, checked) => {
        const { selected, onSelectedChanged, disabled } = this.props;

        if(disabled) return true;

        if(checked) {
            onSelectedChanged({selected, onSelectedChanged, disabled})
        } else {
            const index = selected.indexOf(option.value);
            const removed = [
                ...selected.slice(0, index),
                ...selected.slice(index, 1)
            ];

            onSelectedChanged(removed);
        }
    }

    renderItems() {
        const { options, selected, focusIndex, onClick, ItemRenderer, disabled } = this.props;
        return options.map((o, i) => 
            <li
                key={Object.prototype.hasOwnProperty.call(o, 'key') ? o.key : i}
                style={{ listStyle: 'none'}}
            >
                <SelectItem
                    focused={focusIndex === 1}
                    option={o}
                    onSelectChanged={c => this.handleSelectionChanged(o, c)}
                    checked={selected.includes(o.value)}
                    onClick={e => onClick(e, i)}
                    ItemRenderer={ItemRenderer}
                    disabled={disabled}
                />
            </li>
        )
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

SelectList.displayName = 'SelectList';

SelectList.propTypes = {
    selected: PropTypes.arrayOf(Object).isRequired,
    options: PropTypes.arrayOf({
        label: PropTypes.string.isRequired,
        value: PropTypes.string.isRequired,
        key: PropTypes.string,
    }),
    focusIndex: PropTypes.number.isRequired,
    onSelectedChanged: PropTypes.func,
    onClick: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
    ItemRenderer: PropTypes.element.isRequired
}

export default SelectList;