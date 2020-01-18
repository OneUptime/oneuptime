import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { TimePicker, MuiPickersUtilsProvider } from '@material-ui/pickers'
import { createMuiTheme, MuiThemeProvider } from '@material-ui/core/styles';
import MomentUtils from '@date-io/moment';
import { setStartDate, setEndDate } from '../../actions/dateTime';

const theme = createMuiTheme({
    palette: {
        primary: {
            main: '#0080a8'
        },
        secondary: {
            main: '#0066ff'
        }
    }
})
class TimeRangeSelector extends Component {
    constructor(props) {
        super(props);
        this.state = {
            isOpenStart: false,
            isOpenEnd: false,
        };
    }

    handleChangeStart = (option) => {
        this.props.setStartDate(option);
        if (this.props.endDate.diff(option, 'minutes') <= 0) {
            this.props.setEndDate(option);
        }
        if (this.props.onChange) {
            this.props.onChange(option, this.props.endDate);
        }
    };

    handleChangeEnd = (option) => {
        this.props.setEndDate(option);
        if (option.diff(this.props.startDate, 'minutes') <= 0) {
            this.props.setStartDate(option);
        }
        if (this.props.onChange) {
            this.props.onChange(this.props.startDate,option);
        }
    };

    onToggleStart = () => {
        this.setState({ isOpenStart: !this.state.isOpenStart })
    };

    onToggleEnd = () => {
        this.setState({ isOpenEnd: !this.state.isOpenEnd })
    };

    renderSelectionValue = () => {
        var startTime = this.props.startDate ? this.props.startDate.format('LT') : '';
        var endTime = this.props.endDate ? this.props.endDate.format('LT') : '';
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
                                onClick={this.onToggleStart}
                            >
                                {startTime}
                            </span>
                            <span
                                className="db-DateRangeInput-input-arrow"
                                style={{ padding: '3px' }}
                            />
                            <span
                                className="db-DateRangeInput-end"
                                style={{ padding: '3px' }}
                                onClick={this.onToggleEnd}
                            >
                                {endTime}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    timepickercomponent = (name, value, isOpen, handleChange, okLabel) => {
        return (
            <MuiThemeProvider theme={theme}>
                <MuiPickersUtilsProvider utils={MomentUtils}>
                    <TimePicker
                        name={name}
                        margin="normal"
                        id={`time-range-picker-${name}`}
                        value={value}
                        error={false}
                        invalidDateMessage={false}
                        variant="dialog"
                        style={{ display: 'none' }}
                        open={isOpen}
                        okLabel={okLabel}
                        onClose={() => this.setState({ isOpenStart: false, isOpenEnd: false })}
                        onAccept={() => this.setState({ isOpenStart: false, isOpenEnd: false })}
                        onChange={handleChange}
                        emptyLabel="Select Time"
                        initialFocusedDate={null}
                    />
                </MuiPickersUtilsProvider>
            </MuiThemeProvider>
        )
    };

    render() {
        const { style, name1, name2 } = this.props;
        return (
            <div>
                <div>{this.renderSelectionValue()}</div>
                <span>
                    <div style={{ ...style, height: '28px', marginTop: '-15px' }}>
                        {this.timepickercomponent(name1, this.props.startDate, this.state.isOpenStart, this.handleChangeStart, 'set Start Time')}
                        {this.timepickercomponent(name2, this.props.endDate, this.state.isOpenEnd, this.handleChangeEnd, 'set End Time')}
                    </div>
                </span>
            </div>
        );
    }
}

TimeRangeSelector.displayName = 'TimeRangeSelector';

TimeRangeSelector.propTypes = {
    endDate: PropTypes.object,
    name1: PropTypes.string,
    name2: PropTypes.string,
    onChange: PropTypes.func,
    setEndDate: PropTypes.func,
    setStartDate: PropTypes.func,
    startDate: PropTypes.object,
    style: PropTypes.object
};

const mapDispatchToProps = dispatch => bindActionCreators(
    { setStartDate, setEndDate }, dispatch
)

function mapStateToProps(state) {
    return {
        startDate: state.dateTime.dates.startDate,
        endDate: state.dateTime.dates.endDate
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(TimeRangeSelector);