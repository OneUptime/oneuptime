const path = require('path');

module.exports = {
    mode: 'production',
    entry: './src/logger.js',
    output: {
        path: path.resolve('dist'),
        filename: 'logger.js',
        libraryTarget: 'commonjs2',
    },
    module: {
        rules: [
            {
                test: /\.js?$/,
                exclude: /(node_modules)/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                    },
                },
            },
        ],
    },
    resolve: {
        extensions: ['.js'],
    },
};
