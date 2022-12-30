const path = require("path");
const webpack = require("webpack");
const dotenv = require('dotenv');
const express = require('express');

const readEnvFile = (pathToFile) => {

    const parsed = dotenv.config({ path: pathToFile }).parsed;

    const env = {};

    for (const key in parsed) {
        env[key] = JSON.stringify(parsed[key]);
    }


    return env;
}

module.exports = {
    entry: "./src/Index.tsx",
    mode: "development",
    output: {
        filename: "bundle.js",
        path: path.resolve(__dirname, "public", "dist"),
        publicPath: "/accounts/dist/",
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss'],
        alias: {
            react: path.resolve('./node_modules/react'),
        }
    },
    externals: {
        'react-native-sqlite-storage': 'react-native-sqlite-storage'
    },
    plugins: [
        new webpack.DefinePlugin({
            'process': {
                'env': {
                    ...readEnvFile('../Common/.env'),
                    ...readEnvFile('../CommonUI/.env'),
                    ...readEnvFile('./.env')
                }
            }
        }),
    ],
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/,
                use: 'ts-loader'
            },
            {
                test: /\.s[ac]ss$/i,
                use: ['style-loader', 'css-loader', "sass-loader"]
            },
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.(jpe?g|png|gif|svg)$/i,
                loader: 'file-loader'
            }
        ],
    },
    devServer: {
        historyApiFallback: true,
        devMiddleware: {
            writeToDisk: true,
        },
        allowedHosts: "all",
        setupMiddlewares: (middlewares, devServer) => {
            devServer.app.use('/accounts/assets', express.static(path.resolve(__dirname, 'public', 'assets')));
            return middlewares;
        }
    },
    devtool: 'eval-source-map',
}