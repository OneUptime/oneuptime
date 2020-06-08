// gulpfile.js
var gulp = require( "gulp" );
var webpack = require( "webpack-stream" );
var sourcemaps = require( "gulp-sourcemaps" );
var rename = require( "gulp-rename" );
var uglify = require( "gulp-uglify" );

gulp.task( "build", function() {
   return gulp.src( "src/logger.js" )
      .pipe( webpack( require( "./webpack.config.js" ) ) )
      .pipe( gulp.dest( "./lib" ) )
      .pipe( sourcemaps.init( { loadMaps: true } ) )
      .pipe( uglify() )
      .pipe( rename( "logger.min.js" ) )
      .pipe( sourcemaps.write( "./" ) )
      .pipe( gulp.dest( "lib/" ) );
} );
