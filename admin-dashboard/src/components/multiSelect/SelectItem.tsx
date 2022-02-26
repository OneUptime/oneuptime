import React from 'react';
import PropTypes from 'prop-types';

//#region

const DefaultRenderer = ({
    checked,
    option,
    disabled,
    onClick
}: $TSFixMe) => (
    <span className="db-MultiSelect-item-renderer">
        <input
            type="checkbox"
            onChange={onClick}
            checked={checked}
            disabled={disabled}
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
            tabIndex="-1"
        />
        <span className="db-MultiSelect-renderer-label">{option.label}</span>
    </span>
);

DefaultRenderer.displayName = 'DefaultRenderer';

DefaultRenderer.propTypes = {
    checked: PropTypes.bool.isRequired,
    option: PropTypes.objectOf({
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ label: PropTypes.Validator<str... Remove this comment to see the full error message
        label: PropTypes.string.isRequired,
        value: PropTypes.string.isRequired,
    }),
    disabled: PropTypes.bool,
    onClick: PropTypes.func,
};
//#endregion

class SelectItem extends React.Component {
    handleClick: $TSFixMe;
    labelRef: $TSFixMe;
    state = {
        hovered: false,
    };

    componentDidMount() {
        this.updateFocus();
    }

    componentDidUpdate() {
        this.updateFocus();
    }

    onChecked = (e: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'onSelectionChanged' does not exist on ty... Remove this comment to see the full error message
        const { onSelectionChanged } = this.props;
        const { checked } = e.target;

        onSelectionChanged(checked);
    };

    toggleChecked = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'checked' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { checked, onSelectionChanged } = this.props;
        onSelectionChanged(!checked);
    };

    updateFocus() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'focused' does not exist on type '{ hover... Remove this comment to see the full error message
        const { focused } = this.state;

        if (focused && this.labelRef) {
            this.labelRef.focus();
        }
    }

    handleKeyDown = (e: $TSFixMe) => {
        switch (e) {
            case 13:
                break;
            case 32:
                this.toggleChecked();
                break;
            default:
                return;
        }

        e.preventDefault();
    };
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'option' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { option, checked, disabled, ItemRenderer, focused } = this.props;
        const { hovered } = this.state;

        return (
            <label
                role="option"
                aria-selected={checked}
                aria-required="true"
                selected={checked}
                ref={ref => (this.labelRef = ref)}
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                className={`db-MultiSelect-select-container ${(hovered ||
                    focused) &&
                    'db-MultiSelect-item-container--hover'}`}
                onKeyDown={this.handleKeyDown}
                onMouseOver={() => this.setState({ hovered: true })}
                onMouseOut={() => this.setState({ hovered: false })}
            >
                {ItemRenderer ? (
                    <ItemRenderer
                        option={option}
                        checked={checked}
                        onClick={this.handleClick}
                        disabled={disabled}
                    />
                ) : (
                    <DefaultRenderer
                        option={option}
                        checked={checked}
                        onClick={this.handleClick}
                        disabled={disabled}
                    />
                )}
            </label>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SelectItem.displayName = 'SelectItem';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SelectItem.propTypes = {
    checked: PropTypes.bool.isRequired,
    option: PropTypes.objectOf({
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ label: PropTypes.Validator<str... Remove this comment to see the full error message
        label: PropTypes.string.isRequired,
        value: PropTypes.string.isRequired,
        key: PropTypes.string,
    }),
    focused: PropTypes.bool,
    onSelectionChanged: PropTypes.func,
    disabled: PropTypes.bool,
    ItemRenderer: PropTypes.element.isRequired,
};

export default SelectItem;
