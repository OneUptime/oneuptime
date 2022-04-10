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

        # run only if user agreed to use this feature
        if @options[:captureCodeSnippet] == true
            obj = getErrorCodeSnippet(obj)
        end

        return obj
    end

    def getErrorCodeSnippet(errorObj)
        frames = [] 
        if errorObj["stacktrace"] != nil
            frames = errorObj["stacktrace"]["frames"]
        end

        # get content related to each frame
        contentFrame = [];

        frames.each do |frame|
            updateFrame = getFrameContent(frame)
            # update content of each frame
            updateFrameContent(frame)
            contentFrame.append(updateFrame)
        end

        errorObj["stacktrace"]["frames"] = frames
        return errorObj
    end

    def getFrameContent(frame)
    
        fileName = frame['fileName']

        # # try to read the file content and save to frame
        begin
            file = File.open(fileName)
            frame["sourceFile"] = file.readlines.map(&:chomp)

        rescue  => exception
            # something terrible went wrong
            puts "Warning; Could read file: #{exception.message}"      
        ensure
            file.close      
        end
        
        return frame
    end

    def updateFrameContent(frame)
        lines = []
        if frame["sourceFile"] != nil
            lines = frame["sourceFile"]
        end
        localFrame = addCodeSnippetToFrame(lines, frame)
        frame = localFrame
        return frame
    end

    def addCodeSnippetToFrame(lines, frame, linesOfContext = 5)
    
        if lines.length() < 1 
            return
        end

        lineNumber = 0
        if frame['lineNumber'] != nil
            lineNumber = frame['lineNumber'].to_i
        end

        maxLines = lines.length()
        sourceLine = max(min(maxLines, lineNumber - 1), 0)
        # attach the line before the error
        frame['linesBeforeError'] = getPathOfLines(lines, max(0, sourceLine - linesOfContext), linesOfContext)
        # attach the line after the error
        frame['linesAfterError'] = getPathOfLines(
            lines,
            min(sourceLine + 1, maxLines),
            1 + linesOfContext
        )
        # attach the error line
        frame['errorLine'] = lines[min(maxLines - 1, sourceLine)]

        # remove the source file
        frame.delete('sourceFile')

        return frame
    end

    private
    def getPathOfLines(lines, start, count)
        terminal = start + count
        return lines[start..terminal]
    end

    private
    def max (a,b)
        a>b ? a : b
    end

    private
    def min (a,b)
        a<b ? a : b
    end

        
end