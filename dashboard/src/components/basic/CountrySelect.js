import React, { Component } from 'react';
import {
    getCountries,
    getCountryCallingCode,
} from 'react-phone-number-input/input';
import en from 'react-phone-number-input/locale/en.json';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';
import { PropTypes } from 'prop-types';

class CountrySelect extends Component {
    state = { country: '' };

    componentDidMount() {
        const { value } = this.props;
        this.setState({ country: value });
    }

    setCountry = country => {
        const { onChange } = this.props;
        onChange(country);
        this.setState({ country });
    };

    render() {
        const { country } = this.state;
        const options = getCountries().map(country => (
            <MenuItem
                title={country}
                key={country}
                onClick={() => this.setCountry(country)}
            >
                <div className="Flex-flex Flex-direction--row">
                    <div
                        className="Margin-right--8"
                        style={{ overflow: 'auto' }}
                    >
                        {this.props.iconComponent({
                            country,
                        })}
                    </div>
                    <div className="Margin-right--8 Text-fontWeight--medium">
                        <span>{en[country]}</span>
                    </div>
                    <div className="Margin-right--8">
                        {' +' + getCountryCallingCode(country)}
                    </div>
                </div>
            </MenuItem>
        ));

        return (
            <div style={{ width: '50px' }}>
                <div>
                    <Dropdown>
                        <Dropdown.Toggle
                            id="filterToggle"
                            title=""
                            className="bs-Button bs-DeprecatedButton"
                            style={{ boxShadow: 'unset' }}
                        >
                            <div style={{ float: 'left' }}>
                                {this.props.iconComponent({
                                    country,
                                })}
                            </div>
                        </Dropdown.Toggle>
                        <Dropdown.Menu
                            style={{
                                maxHeight: '200px',
                                overflow: 'scroll',
                                marginTop: '2px',
                            }}
                        >
                            {options}
                        </Dropdown.Menu>
                    </Dropdown>
                </div>
            </div>
        );
    }
}

CountrySelect.displayName = 'CountrySelect';

CountrySelect.propTypes = {
    onChange: PropTypes.func,
    iconComponent: PropTypes.func,
    value: PropTypes.string,
};

export default CountrySelect;
