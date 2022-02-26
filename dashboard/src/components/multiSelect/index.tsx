import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Dropdown from './DropDown';
import SelectPanel from './SelectPanel';

class MultiSelect extends Component {
    state = {};

    getSelectedText() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'options' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { options, selected } = this.props;
        const selectedOptions = selected.map((s: $TSFixMe) => options.find((o: $TSFixMe) => o.value === s)
        );
        const selectedLabels = selectedOptions.map((s: $TSFixMe) => s ? s.label : '');
        return selectedLabels.join(', ');
    }

    renderHeader() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'options' does not exist on type 'Readonl... Remove this comment to see the full error message
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

    handleSelectedChange = (selected: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'onSelectedChanged' does not exist on typ... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ItemRenderer' does not exist on type 'Re... Remove this comment to see the full error message
            ItemRenderer,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'options' does not exist on type 'Readonl... Remove this comment to see the full error message
            options,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'selected' does not exist on type 'Readon... Remove this comment to see the full error message
            selected,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectAllLabel' does not exist on type '... Remove this comment to see the full error message
            selectAllLabel,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isLoading' does not exist on type 'Reado... Remove this comment to see the full error message
            isLoading,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'disabled' does not exist on type 'Readon... Remove this comment to see the full error message
            disabled,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'disableSearch' does not exist on type 'R... Remove this comment to see the full error message
            disableSearch,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filterOptions' does not exist on type 'R... Remove this comment to see the full error message
            filterOptions,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'shouldToggleHover' does not exist on typ... Remove this comment to see the full error message
            shouldToggleHover,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'hasSelectAll' does not exist on type 'Re... Remove this comment to see the full error message
            hasSelectAll,
        } = this.props;

        return (
            <div className="db-MultiSelect">
                <Dropdown
                    // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MultiSelect.displayName = 'MultiSelect';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'defaultProps' does not exist on type 'ty... Remove this comment to see the full error message
MultiSelect.defaultProps = {
    hasSelectAll: true,
    shouldToggleHover: false,
    selected: [],
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
MultiSelect.propTypes = {
    selected: PropTypes.arrayOf(Object),
    options: PropTypes.arrayOf({
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ option: PropTypes.Requireable<... Remove this comment to see the full error message
        option: PropTypes.objectOf({
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ label: PropTypes.Validator<str... Remove this comment to see the full error message
            label: PropTypes.string.isRequired,
            value: PropTypes.string.isRequired,
            key: PropTypes.string,
        }),
    }),
    valueRenderer: {
        selected: PropTypes.any,
        options: PropTypes.arrayOf({
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ label: PropTypes.Validator<str... Remove this comment to see the full error message
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
