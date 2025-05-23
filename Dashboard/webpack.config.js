require("ts-loader");
require("file-loader");
require("style-loader");
require("css-loader");
require("sass-loader");
require('ejs');
const path = require("path");
const webpack = require("webpack");
const dotenv = require("dotenv");
const CompressionPlugin = require('compression-webpack-plugin');
const BundleAnalyzerPlugin =
  require("webpack-bundle-analyzer").BundleAnalyzerPlugin;

const readEnvFile = (pathToFile) => {
  const parsed = dotenv.config({ path: pathToFile }).parsed;

  const env = {};

  for (const key in parsed) {
    env[key] = JSON.stringify(parsed[key]);
  }

  return env;
};

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  entry: "./src/Index.tsx",
  mode: isProduction ? "production" : "development",
  output: {
    filename: isProduction ? '[name].[contenthash].js' : '[name].js',
    chunkFilename: isProduction ? '[name].[contenthash].js' : '[name].js',
    path: path.resolve(__dirname, "public", "dist"),
    publicPath: "/dashboard/dist/",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".scss"],
    alias: {
      react: path.resolve("./node_modules/react"),
    },
  },
  externals: {
    "react-native-sqlite-storage": "react-native-sqlite-storage",
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
        },
      },
    },
    runtimeChunk: 'single',
  },
  plugins: [
    new webpack.DefinePlugin({
      process: {
        env: {
          ...readEnvFile("/usr/src/app/dev-env/.env"),
        },
      },
    }),
    new CompressionPlugin({
      algorithm: 'gzip',
      test: /\.(js|css|html|svg)$/,
      threshold: 10240,
      minRatio: 0.8,
    }),
    process.env.analyze === "true" ? new BundleAnalyzerPlugin() : () => {},
  ],
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        loader: "ts-loader",
      },
      {
        test: /\.s[ac]ss$/i,
        use: ["style-loader", "css-loader", "sass-loader"],
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(jpe?g|png|gif|svg)$/i,
        loader: "file-loader",
      },
    ],
  },
  devtool: isProduction ? 'source-map' : 'eval-source-map',
};
