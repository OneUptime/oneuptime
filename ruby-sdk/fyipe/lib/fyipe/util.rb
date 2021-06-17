require 'securerandom'
require_relative 'logtype'

class Util 

    def initialize(options)
        @options = options
    end

    def v4()
        return SecureRandom.uuid
    end

    def getErrorType(val)
        enumValue = ""
        LogType.each do |key, enum|
            if (key.to_s.eql? "#{val}")
                enumValue = enum.value
            end
        end
        
        return enumValue
    end
    def getExceptionStackTrace(exception)
        frames = [];
        lineNumber = 'N/A'

        obj = {}
        obj["type"] = exception.class
        obj["message"] = exception.message
        obj["lineNumber"] = lineNumber
        
        backtraces = exception.backtrace
        backtraces != nil ?
        backtraces.each do |backtrace|
            breakdown = backtrace.split(":")
            fileName = breakdown[0]
            lineNumber = breakdown[1]
            methodName = breakdown[2]
            frame = {}
            frame["fileName"] = fileName
            frame["methodName"] = methodName
            frame["lineNumber"] = lineNumber
            frames.append(frame)
        end
        : nil

        stacktrace = {}
        stacktrace["frames"] = frames
        
        obj["stacktrace"] = stacktrace
        obj["lineNumber"] = frames[0] ? frames[0]["lineNumber"] : lineNumber

        # TODO run only if user agreed to use this feature
        # if self.options['captureCodeSnippet'] is True:
        #     obj = self.getErrorCodeSnippet(obj)

        return obj
    end
end