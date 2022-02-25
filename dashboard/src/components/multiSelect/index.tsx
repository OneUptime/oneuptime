import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Dropdown from './DropDown';
import SelectPanel from './SelectPanel';

class MultiSelect extends Component {
    state = {};

    getSelectedText() {
        const { options, selected } = this.props;
        const selectedOptions = selected.map(s =>
            options.find(o => o.value === s)
        );
        const selectedLabels = selectedOptions.map(s => (s ? s.label : ''));
        return selectedLabels.join(', ');
    }

    renderHeader() {
        const { options, selected, valueRenderer } = this.props;

        const noneSelected = selected.length === 0;
        const allSelected = selected.length === options.length;

        const customText = valueRenderer && valueRenderer(selected, options);

        if (noneSelected) {
            return (
                <span className="db-MultiSelect-none--selected">
                    {customText || 'Select at least one monitor'}
                </span>
            );
        }

        if (customText) return <span>{customText}</span>;

        return (
            <span>
                {allSelected ? 'All items selected' : this.getSelectedText()}
            </span>
        );
    }

    handleSelectedChange = selected => {
        const { onSelectedChanged, disabled } = this.props;

        if (disabled) {
            return;
        }

        if (onSelectedChanged) {
            onSelectedChanged(selected);
        }
    };
    render() {
        const {
            ItemRenderer,
            options,
            selected,
            selectAllLabel,
            isLoading,
            disabled,
            disableSearch,
            filterOptions,
            shouldToggleHover,
            hasSelectAll,
        } = this.props;

        return (
            <div className="db-MultiSelect">
                <Dropdown
                    isLoading={isLoading}
                    ContentComponent={SelectPanel}
                    shouldToggleHover={shouldToggleHover}
                    contentProps={{
                        ItemRenderer,
                        options,
                        hasSelectAll,
                        selected,
                        selectAllLabel,
                        onSelectedChanged: this.handleSelectedChange,
                        disabled,
                        disableSearch,
                        filterOptions,
                    }}
                    disabled={disabled}
                >
                    {this.renderHeader()}
                </Dropdown>
            </div>
        );
    }
}

MultiSelect.displayName = 'MultiSelect';

MultiSelect.defaultProps = {
    hasSelectAll: true,
    shouldToggleHover: false,
    selected: [],
};

MultiSelect.propTypes = {
    selected: PropTypes.arrayOf(Object),
    options: PropTypes.arrayOf({
        option: PropTypes.objectOf({
            label: PropTypes.string.isRequired,
            value: PropTypes.string.isRequired,
            key: PropTypes.string,
        }),
    }),
    valueRenderer: {
        selected: PropTypes.any,
        options: PropTypes.arrayOf({
            label: PropTypes.string.isRequired,
            value: PropTypes.string.isRequired,
            key: PropTypes.string,
        }),
    },
    ItemRenderer: PropTypes.element,
    selectAllLabel: PropTypes.string,
    onSelectedChanged: PropTypes.func,
    disableSearch: PropTypes.bool,
    disabled: PropTypes.bool,
    hasSelectAll: PropTypes.bool,
    isLoading: PropTypes.bool,
    shouldToggleHover: PropTypes.bool,
    filterOptions: PropTypes.any,
};

export default MultiSelect;
