const path = require("path");
const webpack = require("webpack");
const dotenv = require('dotenv');

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
        path: path.resolve("dist"),
        publicPath: "/",
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json', '.css', '.scss']
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