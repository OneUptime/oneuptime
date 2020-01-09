import React, { Component } from 'react';
import ClickOutside from 'react-click-outside';
import DatetimeRangePicker from 'react-daterange-picker';
import PropTypes from 'prop-types';
import originalMoment from 'moment';
import { extendMoment } from 'moment-range';
const moment = extendMoment(originalMoment);

class DateTimeRangeWrapper extends Component {
    constructor(props, context) {
        super(props, context);

        const today = moment();

        this.state = {
            isOpen: false,
            value: moment.range(today.clone().subtract(this.props.dateRange ? this.props.dateRange : 1, 'days'), today.clone())
        };
    }

    onSelect = (value) => {
        this.setState({ value });
        this.props.onChange(this.state.value.start.toDate(), this.state.value.end.toDate());
    };

    onToggle = () => {
        this.setState({ isOpen: !this.state.isOpen });
    };

    renderSelectionValue = () => {
        return (
            <div>
                <div
                    className="db-DateRangeInputWithComparison"
                    style={{

                    }}
                >
                    <div
                        className="db-DateRangeInput bs-Control"
                        style={{
                            cursor: 'pointer',
                        }}
                        onClick={this.onToggle}
                    >
                        <div
                            className="db-DateRangeInput-input"
                            role="button"
                            tabIndex="0"
                            style={{ cursor: 'pointer' }}
                        >
                            <span
                                className="db-DateRangeInput-start"
                                style={{ padding: '3px' }}
                            >
                                {this.state.value.start.format('lll')}
                            </span>
                            <span
                                className="db-DateRangeInput-input-arrow"
                                style={{ padding: '3px' }}
                            />
                            <span
                                className="db-DateRangeInput-end"
                                style={{ padding: '3px' }}
                            >
                                {this.state.value.end.format('lll')}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    render() {
        return (
            <ClickOutside onClickOutside={() => this.setState({ isOpen: false })}>
                <div>{this.renderSelectionValue()}</div>

                {this.state.isOpen && (
                    <DatetimeRangePicker
                        className="DateRangePicker-left"
                        value={this.state.value}
                        numberOfCalendars={1}
                        selectionType={'range'}
                        onSelect={this.onSelect}
                        singleDateRange={true}
                    />
                )}
            </ClickOutside>
        );
    }
}

DateTimeRangeWrapper.displayName = 'DateTimeRangeWrapper'

DateTimeRangeWrapper.propTypes = {
    onChange: PropTypes.func,
    dateRange: PropTypes.oneOfType([PropTypes.object, PropTypes.number]),
}

export default DateTimeRangeWrapper;
