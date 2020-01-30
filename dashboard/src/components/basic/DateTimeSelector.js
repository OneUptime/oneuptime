import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { createMuiTheme, MuiThemeProvider } from '@material-ui/core/styles';
import { DateTimePicker, MuiPickersUtilsProvider } from '@material-ui/pickers';
import DateFnsUtils from '@date-io/date-fns';

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

const DateTimeSelector = ({ input, meta: { touched, error }, style }) => {
    const [value, setValue] = useState(input.value);
    const handleChange = (option) => {
        setValue(option);
        if (input.onChange) {
            input.onChange(new Date(option).toUTCString());
        }
    };


    return (
        <span>
            <div style={{ ...style, width:'250px', height: '28px', marginTop: '-15px' }}>

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
                          emptyLabel="Select Date"
                          initialFocusedDate={null}
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

DateTimeSelector.displayName = 'TimeSelector';

DateTimeSelector.propTypes = {
    input: PropTypes.object.isRequired,
    style: PropTypes.object,
    meta: PropTypes.object.isRequired
};

export default DateTimeSelector;