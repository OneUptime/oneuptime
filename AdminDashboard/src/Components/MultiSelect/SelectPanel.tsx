import React from 'react';
import PropTypes from 'prop-types';

import { filterOptions as customFilterOptions } from 'fuzzy-match-utils';
import SelectItem from './SelectItem';
import SelectList from './SelectList';

class SelectPanel extends Component<ComponentProps> {
    onBlur: $TSFixMe;
    onFocus: $TSFixMe;
    state = {
        searchHasFocus: false,
        searchText: '',
        focusIndex: 0,
    };

    selectAll = () => { };

    selectNone = () => { };

    selectAllChanged = (checked: $TSFixMe) => {
        if (checked) this.selectAll();
        else this.selectNone();
    };

    handleSearchChange = (e: $TSFixMe) => {
        this.setState({
            searchText: e.target.value,
            focusIndex: -1,
        });
    };

    handleItemClicked = (index: $TSFixMe) => {
        this.setState({
            focusIndex: index,
        });
    };

    clearSearch = () => this.setState({ searchText: '' });

    handleKeyDown = (e: $TSFixMe) => {
        switch (e) {
            case 38:
                if (e.altKey) return;

                this.updateFocus(-1);
                break;
            case 40:
                if (e.altKey) return;

                this.updateFocus(1);
                break;
            default:
                return;
        }

        e.stopPropagation();
        e.preventDefault();
    };

    handleSearchFocus = (searchHasFocus: $TSFixMe) => {
        this.setState({
            searchHasFocus,
            focusIndex: -1,
        });
    };

    allAreSelected() {

        const { options, selected }: $TSFixMe = this.props;
        return options.length === selected.length;
    }

    filteredOptions() {
        const { searchText }: $TSFixMe = this.state;

        const { options, filterOptions }: $TSFixMe = this.props;

        return customFilterOptions
            ? customFilterOptions(options, searchText)
            : filterOptions(options, searchText);
    }

    updateFocus(offset: $TSFixMe) {
        const { focusIndex }: $TSFixMe = this.state;

        const { options }: $TSFixMe = this.props;

        let tempFocus = focusIndex + offset;
        tempFocus = Math.max(0, tempFocus);
        tempFocus = Math.min(tempFocus, options.length);

        this.setState({ focusIndex: tempFocus });
    }

    override render() {
        const {

            ItemRenderer,

            selectAllLabel,

            disabled,

            disableSearch,

            hasSelectAll,
        } = this.props;
        const { focusIndex, searchHasFocus }: $TSFixMe = this.state;

        const selectAllOption: $TSFixMe = {
            label: selectAllLabel || 'Select All',
            value: '',
        };

        return (
            <div
                className="db-MultiSelect-search-panel db-MultiSelect-panel"
                role="listbox"
                onKeyDown={this.handleKeyDown}
            >
                {disableSearch && (
                    <div className="db-MultiSelect-search-container">
                        <input
                            placeholder="Search"
                            type="text"
                            className={`db-MultiSelect-search ${searchHasFocus &&
                                'db-MultiSelect-search--focused'}`}
                            onChange={this.handleSearchChange}
                            onBlur={this.onBlur}
                            onFocus={this.onFocus}
                        />
                    </div>
                )}
                {hasSelectAll && (
                    <SelectItem

                        focused={focusIndex === 0}
                        checked={this.allAreSelected}
                        option={selectAllOption}
                        onSelectChanged={this.selectAllChanged}
                        onClick={() => this.handleItemClicked(0)}
                        ItemRenderer={ItemRenderer}
                        disabled={disabled}
                    />
                )}

                <SelectList
                    {...this.props}

                    options={this.filteredOptions()}
                    focusIndex={focusIndex - 1}
                    onClick={(e: $TSFixMe, index: $TSFixMe) => this.handleItemClicked(index + 1)}
                    ItemRenderer={ItemRenderer}
                    disabled={disabled}
                />
            </div>
        );
    }
}


SelectPanel.displayName = 'SelectPanel';


SelectPanel.propTypes = {
    ItemRenderer: PropTypes.element,
    options: PropTypes.arrayOf({

        label: PropTypes.string.isRequired,
        value: PropTypes.string.isRequired,
        key: PropTypes.string,
    }),
    selected: PropTypes.array.isRequired,
    selectAllLabel: PropTypes.string,
    onSelectedChanged: PropTypes.func,
    disableSearch: PropTypes.bool,
    disabled: PropTypes.bool,
    hasSelectAll: PropTypes.bool,
    filterOptions: PropTypes.any,
};

export default SelectPanel;
