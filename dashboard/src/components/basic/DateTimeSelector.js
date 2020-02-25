import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { createMuiTheme, MuiThemeProvider } from '@material-ui/core/styles';
import { DateTimePicker, MuiPickersUtilsProvider } from '@material-ui/pickers';
import DateFnsUtils from '@date-io/date-fns';
import { withStyles } from '@material-ui/core/styles';

const theme = createMuiTheme({
    palette: {
        primary: {
            main: '#000000'
        },
        secondary: {
            main: '#0066ff'
        }
    }
})

const styles = () => ({
    input: {
        'flex': '0 0 auto', 'padding': '4px 7px 2px', 'backgroundColor': '#fff', 'borderRadius': '4px', 'boxShadow': '0 0 0 1px rgba(50, 50, 93, 0.16), 0 0 0 1px rgba(50, 151, 211, 0), 0 0 0 2px rgba(50, 151, 211, 0), 0 1px 1px rgba(0, 0, 0, 0.08)', 'color': '#000000', 'cursor': 'text', 'fontSize': '14px', 'lineHeight': '1.6', 'textAlign': 'left', 'textDecoration': 'none', 'verticalAlign': 'middle', 'whiteSpace': 'nowrap', 'wordBreak': 'keep-all', 'transition': 'box-shadow 0.08s ease-in, color 0.08s ease-in', 'WebkitUserSelect': 'auto', 'MozUserSelect': 'auto', 'MsUserSelect': 'auto', 'userSelect': 'auto',
        'font-family':'unset',
        height:'32px'
    }
});

const DateTimeSelector = ({ input, meta: { touched, error }, style, classes, minDate }) => {
    if (!input.value) { input.value = null; }
    const [value, setValue] = useState(input.value);
    const handleChange = (option) => {
        setValue(option);
        if (input.onChange) {
            input.onChange(new Date(option).toUTCString());
        }
    };


    return (
        <span>
            <div style={{ width:'10px', height: '28px', marginTop: '-15px', zIndex: 1000 }}>

                <MuiThemeProvider theme={theme}>
                  <MuiPickersUtilsProvider utils={DateFnsUtils}>
                    
                      <DateTimePicker
                          name={input.name}
                          margin="normal"
                          id="time-picker"
                          value={value}
                          error={false}
                          invalidDateMessage={false}
                          variant="modal"
                          onChange={handleChange}
                          KeyboardButtonProps={{
                            'aria-label': 'change time',
                          }}
                          emptyLabel="Select Date and Time"
                          initialFocusedDate={null}
                          InputProps={{ className: classes.input, disableUnderline: true }}
                          style={{...style}}
                          minDate={minDate}
                      />
                    
                  </MuiPickersUtilsProvider>
                </MuiThemeProvider>
            </div>
            {
                touched && error && <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '5px' }}>
                    <div className="Box-root Margin-right--8" style={{ marginTop: '2px' }}>
                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                        </div>
                    </div>
                    <div className="Box-root">
                        <span style={{ color: 'red' }}>
                            {error}
                        </span>
                    </div>
                </div>
            }
        </span>
    );
};

DateTimeSelector.displayName = 'DateTimeSelector';

DateTimeSelector.propTypes = {
    input: PropTypes.object.isRequired,
    style: PropTypes.object,
    meta: PropTypes.object.isRequired,
    classes: PropTypes.object,
    minDate: PropTypes.object,
};

export default withStyles(styles)(DateTimeSelector);