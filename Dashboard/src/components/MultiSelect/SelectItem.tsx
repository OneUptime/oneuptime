import React from 'react';
import PropTypes from 'prop-types';

export interface ComponentProps {
    checked: boolean;
    option?: Record<string, unknown>;
    disabled?: boolean;
    onClick?: Function;
}

//#region

const DefaultRenderer: Function = ({
    checked,
    option,
    disabled,
    onClick
}: DefaultRendererProps) => (
    <span className="db-MultiSelect-item-renderer">
        <input
            type="checkbox"
            onChange={onClick}
            checked={checked}
            disabled={disabled}

            tabIndex="-1"
        />
        <span className="db-MultiSelect-renderer-label">{option.label}</span>
    </span>
);

DefaultRenderer.displayName = 'DefaultRenderer';

DefaultRenderer.propTypes = {
    checked: PropTypes.bool.isRequired,
    option: PropTypes.objectOf({

        label: PropTypes.string.isRequired,
        value: PropTypes.string.isRequired,
    }),
    disabled: PropTypes.bool,
    onClick: PropTypes.func,
};

interface SelectItemProps {
    checked: boolean;
    option?: Record<string, unknown>;
    focused?: boolean;
    onSelectionChanged?: Function;
    disabled?: boolean;
    ItemRenderer: React.ReactElement;
}

//#endregion

class SelectItem extends React.Component<SelectItemProps> {
    handleClick: $TSFixMe;
    labelRef: $TSFixMe;
    state = {
        hovered: false,
    };

    override componentDidMount() {
        this.updateFocus();
    }

    componentDidUpdate() {
        this.updateFocus();
    }

    onChecked = (e: $TSFixMe) => {

        const { onSelectionChanged }: $TSFixMe = this.props;
        const { checked }: $TSFixMe = e.target;

        onSelectionChanged(checked);
    };

    toggleChecked = () => {

        const { checked, onSelectionChanged }: $TSFixMe = this.props;
        onSelectionChanged(!checked);
    };

    updateFocus() {

        const { focused }: $TSFixMe = this.state;

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
    override render() {

        const { option, checked, disabled, ItemRenderer, focused }: $TSFixMe = this.props;
        const { hovered }: $TSFixMe = this.state;

        return (
            <label
                role="option"
                aria-selected={checked}
                aria-required="true"
                selected={checked}
                ref={ref => (this.labelRef = ref)}

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


SelectItem.displayName = 'SelectItem';


SelectItem.propTypes = {
    checked: PropTypes.bool.isRequired,
    option: PropTypes.objectOf({

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
