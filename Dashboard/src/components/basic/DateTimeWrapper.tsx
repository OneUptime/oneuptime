import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { createTheme, MuiThemeProvider } from '@material-ui/core/styles';
import { DateTimePicker, MuiPickersUtilsProvider } from '@material-ui/pickers';
import MomentUtils from '@date-io/moment';
import { withStyles } from '@material-ui/core/styles';
import * as moment from 'moment';

const theme = createTheme({
    palette: {
        primary: {
            main: '#000000',
        },
        secondary: {
            main: '#0066ff',
        },
    },
});

const styles: Function = () => ({
    input: {
        flex: '0 0 auto',
        padding: '4px 4px 2px 7px',
        color: '#000000',
        cursor: 'text',
        fontSize: '14px',
        lineHeight: '1.6',
        textAlign: 'left',
        textDecoration: 'none',
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
        wordBreak: 'keep-all',
        transition: 'box-shadow 0.08s ease-in, color 0.08s ease-in',
        WebkitUserSelect: 'auto',
        MozUserSelect: 'auto',
        MsUserSelect: 'auto',
        userSelect: 'auto',
        'font-family': 'unset',
        height: '32px',
        fontWeight: '500',
    },
});

interface DateTimeWrapperProps {
    input: object;
    style?: object;
    meta: object;
    classes?: object;
    minDate?: string | object;
    id?: string;
    label?: string;
    maxDate?: string | object;
}

const DateTimeWrapper: Function = ({
    input,
    meta: { touched, error },
    style,
    classes,
    minDate,
    id,
    label,
    maxDate
}: DateTimeWrapperProps) => {
    if (!input.value) {
        input.value = null;
    }
    const [value, setValue] = useState(input.value);
    const handleChange: Function = (option: $TSFixMe) => {
        setValue(option);
        if (input.onChange) {

            input.onChange(moment(option));
        }
    };

    return (
        <span>
            <div
                style={{
                    height: '28px',
                    marginTop:
                        style && style.marginTop ? style.marginTop : '-32px',
                    fontWeight: '500',
                }}
            >
                <MuiThemeProvider theme={theme}>
                    <MuiPickersUtilsProvider utils={MomentUtils}>
                        <DateTimePicker
                            name={input.name}
                            margin="normal"
                            id={id ? id + 'time-picker' : 'time-picker'}
                            value={value}
                            format={'lll'}
                            error={false}
                            invalidDateMessage={false}

                            variant="modal"
                            onChange={handleChange}
                            KeyboardButtonProps={{
                                'aria-label': 'change time',
                            }}
                            emptyLabel={label ? label : 'Select Date and Time'}
                            initialFocusedDate={null}
                            InputProps={{
                                className: classes.input,
                                disableUnderline: true,
                            }}
                            style={{ ...style }}
                            minDate={minDate}
                            maxDate={maxDate}
                        />
                    </MuiPickersUtilsProvider>
                </MuiThemeProvider>
            </div>
            {touched && error && (
                <div
                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                    style={{ marginTop: '5px' }}
                >
                    <div
                        className="Box-root Margin-right--8"
                        style={{ marginTop: '2px' }}
                    >
                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                    </div>
                    <div className="Box-root">
                        <span style={{ color: 'red' }}>{error}</span>
                    </div>
                </div>
            )}
        </span>
    );
};

DateTimeWrapper.displayName = 'DateTimeWrapper';

DateTimeWrapper.propTypes = {
    input: PropTypes.object.isRequired,
    style: PropTypes.object,
    meta: PropTypes.object.isRequired,
    classes: PropTypes.object,
    minDate: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    id: PropTypes.string,
    label: PropTypes.string,
    maxDate: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
};


export default withStyles(styles)(DateTimeWrapper);
