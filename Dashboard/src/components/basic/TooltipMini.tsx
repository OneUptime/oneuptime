import React from 'react';
import { withStyles } from '@material-ui/core/styles';
import Tooltip from '@material-ui/core/Tooltip';
import PropTypes from 'prop-types';

const TooltipDesign = withStyles(theme => ({
    tooltip: {
        backgroundColor: '#f5f5f9',
        color: 'rgba(0, 0, 0, 0.87)',
        maxWidth: 220,
        fontSize: theme.typography.pxToRem(14),
        border: '1px solid #dadde9',
    },
}))(Tooltip);

interface TooltipMiniProps {
    title?: string;
    content?: object;
}

const TooltipMini: Function = (props: TooltipMiniProps) => <TooltipDesign title={props.title}>{props.content}</TooltipDesign>;

TooltipMini.propTypes = {
    title: PropTypes.string,
    content: PropTypes.object,
};
TooltipMini.displayName = 'TooltipMini';
export default TooltipMini;
