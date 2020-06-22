import React from 'react';
import DateTimeRangeContainer from 'react-advanced-datetimerange-picker';
import moment from 'moment';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

class DateTimeRangeSelector extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            start: props.startDate,
            end: props.endDate,
        };

        this.applyCallback = this.applyCallback.bind(this);
    }

    applyCallback(startDate, endDate) {
        this.setState({
            start: startDate,
            end: endDate,
        });
        this.props.onChange(startDate, endDate);
    }
    renderSelectionValue = () => {
        return (
            <div>
                <div className="db-DateRangeInputWithComparison" style={{}}>
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
                                {this.state.start.format('ll')}
                            </span>
                            <span
                                className="db-DateRangeInput-input-arrow"
                                style={{ padding: '3px' }}
                            />
                            <span
                                className="db-DateRangeInput-end"
                                style={{ padding: '3px' }}
                            >
                                {this.state.end.format('ll')}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    };
    render() {
        const now = new Date();
        const start = moment(
            new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate(),
                0,
                0,
                0,
                0
            )
        );
        const end = moment(start)
            .add(1, 'days')
            .subtract(1, 'seconds');
        const ranges = {
            'Today Only': [moment(start), moment(end)],
            'Yesterday Only': [
                moment(start).subtract(1, 'days'),
                moment(end).subtract(1, 'days'),
            ],
            '3 Days': [moment(start).subtract(3, 'days'), moment(end)],
            '7 Days': [moment(start).subtract(7, 'days'), moment(end)],
            '14 Days': [moment(start).subtract(14, 'days'), moment(end)],
        };
        const local = {
            format: 'DD-MM-YYYY HH:mm',
            sundayFirst: true,
        };
        const maxDate = moment(start).add(24, 'hour');
        const style = {
            fromDot: { backgroundColor: '#98C0E4' },
            toDot: { backgroundColor: '#339AE0' },
            fromDate: {
                backgroundColor: '#98C0E4',
            },
            toDate: { backgroundColor: '#339AE0' },
            betweenDates: {
                color: 'white',
                backgroundColor: '#6EB4F2',
            },
            hoverCell: { color: '#6EB4F2' },
            customRangeSelected: {
                backgroundColor: '#339AE0',
                color: '#F7F7F7',
            },
            customRangeButtons: {
                backgroundColor: '#F7F7F7',
                color: '#339AE0',
                border: 'solid 1px #F7F7F7',
            },
            standaloneLayout: { display: 'flex', maxWidth: 'fit-content' },
            inputDate: { backgroundColor: 'black' },
        };
        return (
            <DateTimeRangeContainer
                ranges={ranges}
                start={this.state.start}
                end={this.state.end}
                local={local}
                maxDate={maxDate}
                applyCallback={this.applyCallback}
                style={style}
            >
                {this.renderSelectionValue()}
            </DateTimeRangeContainer>
        );
    }
}
DateTimeRangeSelector.displayName = 'DateTimeRangeSelector';
DateTimeRangeSelector.propTypes = {
    onChange: PropTypes.func,
    startDate: PropTypes.instanceOf(moment),
    endDate: PropTypes.instanceOf(moment),
};

function mapStateToProps(state) {
    return {
        startDate: state.dateTime.dates.startDate,
        endDate: state.dateTime.dates.endDate,
    };
}

export default connect(mapStateToProps)(DateTimeRangeSelector);
