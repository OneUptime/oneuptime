import React from 'react';
import PropTypes from 'prop-types';

//#region 

const DefaultRenderer = ({ checked, option, disabled, onClick }) => 
        <span className="db-MultiSelect-item-renderer">
            <input
                type="checkbox"
                onChange={onClick}
                checked={checked}
                disabled={disabled}
                tabIndex="-1"
            />
            <span className="db-MultiSelect-renderer-label">
                {option.label}
            </span>
        </span>;

DefaultRenderer.displayName = 'DefaultRenderer';

DefaultRenderer.propTypes = {
    checked: PropTypes.bool.isRequired,
    option: PropTypes.objectOf({
        label: PropTypes.string.isRequired,
        value: PropTypes.string.isRequired
    }),
    disabled: PropTypes.bool,
    onClick: PropTypes.func
}
//#endregion

class SelectItem extends React.Component {
    state = {
        hovered: false
    }

    componentDidMount() {
        this.updateFocus();
    }

    componentDidUpdate() {
        this.updateFocus();
    }

    onChecked = e => {
        const { onSelectionChanged } = this.props;
        const { checked } = e.target;

        onSelectionChanged(checked);
    }

    toggleChecked = () => {
        const { checked, onSelectionChanged } = this.props;
        onSelectionChanged(!checked);
    }

    updateFocus() {
        const { focused } = this.state;

        if(focused && this.labelRef) {
            this.labelRef.focus();
        }
    }

    handleKeyDown = e => {
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
    }
    render() {
        const { option, checked, disabled, ItemRenderer, focused } = this.props;
        const { hovered } = this.state;

        return (
            <label
                role="option"
                aria-selected={checked}
                aria-required="true"
                selected={checked}
                ref={ref => this.labelRef = ref}
                tabIndex="-1"
                className={`db-MultiSelect-select-container ${(hovered || focused) && 'db-MultiSelect-item-container--hover'}`}
                onKeyDown={this.handleKeyDown}
                onMouseOver={() => this.setState({hovered: true})}
                onMouseOut={() => this.setState({hovered: false})}
            >
                {ItemRenderer ?
                    <ItemRenderer
                        option={option}
                        checked={checked}
                        onClick={this.handleClick}
                        disabled={disabled}
                    /> :

                    <DefaultRenderer
                        option={option}
                        checked={checked}
                        onClick={this.handleClick}
                        disabled={disabled}
                    />
                }
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
    ItemRenderer: PropTypes.element.isRequired
}

export default SelectItem;

