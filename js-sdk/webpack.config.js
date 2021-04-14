const path = require('path');

const serverBuild = {
    mode: 'production',
    entry: './src/index.js',
    target: 'node',
    output: {
        path: path.resolve('dist'),
        filename: 'fyipe.js',
        library: 'Fyipe',
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
    node: {
        fs: 'empty',
        child_process: 'empty',
        net: 'empty',
        module: 'empty',
    },
};
/*const webBuild = {
    ...serverBuild,
    target: 'web',
    output: { ...serverBuild.output, filename: 'fyipe.min.js' },
};*/
module.exports = serverBuild;
