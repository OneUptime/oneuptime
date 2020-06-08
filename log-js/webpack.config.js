module.exports = {
    entry: "./src/logger.js",
    // output tells webpack where to put the bundle it creates
    output: {
       library: "logger",
       // We want webpack to build a UMD wrapper for our module
       libraryTarget: "umd",
       // the destination file name
       filename: "lib/logger.js"
    },
    
 };
 