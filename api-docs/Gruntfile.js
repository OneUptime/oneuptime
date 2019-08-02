module.exports = function(grunt) {   

    var config = {
        concat: {
            "js-api": {
                // the files to concatenate
                src: ['api/commonHead.html',
                'api/js/content-guide.html',
                'api/langMenuHeadWrap.html',
                'api/js/introduction.html',
                'api/js/apps.html',
                'api/js/cloudApp.html',
                'api/js/cloudObject.html',
                'api/js/relationships.html',
                'api/js/cloudQuery.html',
                'api/js/cloudNotifications.html',
                'api/js/cloudPushNotifications.html',
                'api/js/cloudObject.html',
                'api/js/cloudSearch.html',
                'api/js/cloudGeoPoint.html',
                'api/js/cloudUser.html',
                'api/js/cloudRole.html',
                'api/js/cloudFile.html',
                'api/js/cloudColumn.html',
                'api/js/cloudTable.html',
                'api/js/cloudACL.html',
                'api/js/cloudJSON.html',
                'api/js/contribute.html',
                'api/langMenuFootWrap.html',
                'api/commonFoot.html'
                ],
                // the location of the resulting javascript html file
                dest: 'javascript.html'
            },

            "java-api": {
                // the files to concatenate
                src: ['api/commonHead.html',
                'api/java/content-guide.html',
                'api/langMenuHeadWrap.html',
                'api/java/introduction.html', 
                'api/java/dependencies.html',
                'api/java/apps.html',                
                'api/java/cloudApp.html',
                'api/java/cloudObjects.html',
                'api/java/relationships.html',
                'api/java/cloudQuery.html',   
                'api/java/cloudNotifications.html',
                'api/java/cloudSearch.html',
                'api/java/cloudACL.html',
                'api/java/cloudUser.html',
                'api/java/cloudRole.html',
                'api/java/cloudFile.html',
				'api/java/cloudPush.html',
                'api/java/contribute.html',
                'api/langMenuFootWrap.html',
                'api/commonFoot.html'
                ],
                // the location of the resulting java html file
                dest: 'java.html'
            },

            "dotnet-api": {
                // the files to concatenate
                src: ['api/commonHead.html',
                'api/dotnet/content-guide.html',
                'api/langMenuHeadWrap.html',
                'api/dotnet/introduction.html',
                'api/dotnet/dependencies.html',
                'api/dotnet/apps.html',
                'api/dotnet/cloudApp.html',
                'api/dotnet/cloudObjects.html',
                'api/dotnet/relationships.html',
                'api/dotnet/cloudQuery.html',
                'api/dotnet/cloudNotifications.html',                
                'api/dotnet/cloudSearch.html',
                'api/dotnet/cloudGeoPoint.html',
                'api/dotnet/cloudUser.html',
                'api/dotnet/cloudRole.html',
                'api/dotnet/cloudFiles.html',
                'api/dotnet/cloudColumn.html',
                'api/dotnet/cloudTable.html',
                'api/dotnet/cloudACL.html', 
                'api/dotnet/contribute.html',                              
                'api/langMenuFootWrap.html',
                'api/commonFoot.html'
                ],
                // the location of the resulting dotnet html file
                dest: 'dotnet.html'
            },
            "curl-api": {
                // the files to concatenate
                src: ['api/commonHead.html',
                'api/curl/content-guide.html',
                'api/langMenuHeadWrap.html',
                'api/curl/introduction.html',
                'api/curl/dependencies.html',
                'api/curl/apps.html',
                'api/curl/cloudObjects.html',
                'api/curl/relationships.html',
                'api/curl/cloudQuery.html',   
                'api/curl/cloudSearch.html',
                'api/curl/cloudACL.html',
                'api/curl/cloudUser.html',
                'api/curl/cloudRole.html',
                'api/curl/cloudFiles.html',
                'api/curl/contribute.html',
                'api/langMenuFootWrap.html',
                'api/commonFoot.html'
                ],
                // the location of the resulting java html file
                dest: 'curl.html'
            }			
        }       
    };   

    grunt.initConfig(config);

    grunt.loadNpmTasks('grunt-contrib-concat');    

    grunt.registerTask('default',['concat:js-api','concat:java-api','concat:dotnet-api','concat:curl-api']);    

};
