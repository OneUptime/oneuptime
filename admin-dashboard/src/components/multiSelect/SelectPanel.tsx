import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'fuzz... Remove this comment to see the full error message
import { filterOptions as customFilterOptions } from 'fuzzy-match-utils';
import SelectItem from './SelectItem';
import SelectList from './SelectList';

class SelectPanel extends React.Component {
    onBlur: $TSFixMe;
    onFocus: $TSFixMe;
    state = {
        searchHasFocus: false,
        searchText: '',
        focusIndex: 0,
    };

    selectAll = () => {};

    selectNone = () => {};

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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'options' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { options, selected } = this.props;
        return options.length === selected.length;
    }

    filteredOptions() {
        const { searchText } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'options' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { options, filterOptions } = this.props;

        return customFilterOptions
            ? customFilterOptions(options, searchText)
            : filterOptions(options, searchText);
    }

    updateFocus(offset: $TSFixMe) {
        const { focusIndex } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'options' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { options } = this.props;

        let tempFocus = focusIndex + offset;
        tempFocus = Math.max(0, tempFocus);
        tempFocus = Math.min(tempFocus, options.length);

        this.setState({ focusIndex: tempFocus });
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ItemRenderer' does not exist on type 'Re... Remove this comment to see the full error message
            ItemRenderer,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectAllLabel' does not exist on type '... Remove this comment to see the full error message
            selectAllLabel,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'disabled' does not exist on type 'Readon... Remove this comment to see the full error message
            disabled,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'disableSearch' does not exist on type 'R... Remove this comment to see the full error message
            disableSearch,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'hasSelectAll' does not exist on type 'Re... Remove this comment to see the full error message
            hasSelectAll,
        } = this.props;
        const { focusIndex, searchHasFocus } = this.state;

        const selectAllOption = {
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
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
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
                    // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SelectPanel.displayName = 'SelectPanel';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SelectPanel.propTypes = {
    ItemRenderer: PropTypes.element,
    options: PropTypes.arrayOf({
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ label: PropTypes.Validator<str... Remove this comment to see the full error message
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
