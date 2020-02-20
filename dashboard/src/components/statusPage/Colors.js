import React from 'react';
import PropTypes from 'prop-types';
import Color from '../basic/Color';

function Colors({
    currentColorPicker,
    handleClick,
    displayColorPicker,
    colors,
    handleChange,
    handleClose,
}) {
    return (
        <div>
            <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label">Background Colors</label>
                <div className="bs-Fieldset-fields">
                    <div
                        className="Box-root Flex-flex"
                        style={{ width: '700px' }}
                    >
                        <Color
                            id="pageBackground"
                            title="Page Background"
                            color={colors.pageBackground}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                        <Color
                            id="statusPageBackground"
                            title="Status Page Background"
                            color={colors.statusPageBackground}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                        <Color
                            id="noteBackground"
                            title="Note Background"
                            color={colors.noteBackground}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                    </div>
                </div>
            </div>
            <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label">Status Colors</label>
                <div className="bs-Fieldset-fields">
                    <div
                        className="Box-root Flex-flex"
                        style={{ width: '700px' }}
                    >
                        <Color
                            id="uptime"
                            title="Uptime"
                            color={colors.uptime}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                        <Color
                            id="downtime"
                            title="Downtime"
                            color={colors.downtime}
                            style={{ marginLeft: '60px' }}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                        <Color
                            id="degraded"
                            title="Degraded"
                            color={colors.degraded}
                            style={{ marginLeft: '84px' }}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                    </div>
                </div>
            </div>
            {/* Text colors */}
            <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label">Text Colors</label>
                <div className="bs-Fieldset-fields">
                    <div
                        className="Box-root Flex-flex"
                        style={{ width: '800px' }}
                    >
                        <Color
                            id="heading"
                            title="Heading Text"
                            color={colors.heading}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                        <Color
                            id="subheading"
                            title="Sub Heading Text"
                            color={colors.subheading}
                            style={{ marginLeft: '25px' }}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                        <Color
                            id="secondaryText"
                            title="Secondary Text"
                            color={colors.secondaryText}
                            style={{ marginLeft: '40px' }}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                        <Color
                            id="primaryText"
                            title="Primary Text"
                            color={colors.primaryText}
                            style={{ marginLeft: '20px' }}
                            currentColorPicker={currentColorPicker}
                            displayColorPicker={displayColorPicker}
                            handleClick={handleClick}
                            handleChange={handleChange}
                            handleClose={handleClose}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

Colors.displayName = 'Colors';

Colors.propTypes = {
    currentColorPicker: PropTypes.string,
    handleClick: PropTypes.func,
    handleChange: PropTypes.func,
    handleClose: PropTypes.func,
    displayColorPicker: PropTypes.bool,
    colors: PropTypes.object,
};

export default Colors;
