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

const styles = () => ({
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

const DateTimeWrapper = ({
    input,
    meta: { touched, error },
    style,
    classes,
    minDate,
    id,
    label,
    maxDate
}: $TSFixMe) => {
    if (!input.value) {
        input.value = null;
    }
    const [value, setValue] = useState(input.value);
    const handleChange = (option: $TSFixMe) => {
        setValue(option);
        if (input.onChange) {
            // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
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
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '"modal"' is not assignable to type 'WrapperV... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2345) FIXME: Argument of type '() => { input: { flex: string; p... Remove this comment to see the full error message
export default withStyles(styles)(DateTimeWrapper);
