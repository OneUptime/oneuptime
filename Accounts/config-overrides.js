const { override, addBabelPlugin } = require("customize-cra");
const pluginProposalDecorators = require("@babel/plugin-proposal-decorators");

module.exports = override(  
    addBabelPlugin(pluginProposalDecorators, {})
);