const path = require("path");
const webpack = require("webpack");

module.exports = {
    entry: "./src/Index.tsx",
    mode: "development",
    output: {
        filename: "bundle.js",
        path: path.resolve("dist"),
        publicPath: "/",
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json']
    },
    externals: {
        'react-native-sqlite-storage': 'react-native-sqlite-storage'
    },
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/,
                use: 'ts-loader'
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.(png|j?g|svg|gif)?$/,
                use: 'file-loader'
            }
        ],
    },
    devServer: {
        historyApiFallback: true,
    },
    devtool: 'inline-source-map',

}