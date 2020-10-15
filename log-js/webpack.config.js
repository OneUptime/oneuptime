const path = require('path');

module.exports = {
    mode: 'production',
    entry: './src/logger.js',
    target: 'node',
    output: {
        path: path.resolve('dist'),
        filename: 'logger.js',
        library: 'FyipeLogger',
        libraryExport: 'default',
        libraryTarget: 'umd',
        globalObject: 'this',
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
