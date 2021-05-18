
from .logtype import LogType
import uuid
import sys

class Util:

    def __init__(self, options):
        self.options = options
    
    def getErrorType(self):
        return LogType
    
    def v4(self):
        return uuid.uuid4().__str__();
    
    def getExceptionStackTrace(self, exception):
        frames = [];
        lineNumber = 'N/A'
        if(exception.__traceback__ is not None):
            lineNumber = exception.__traceback__.tb_lineno
        obj = {
            'type': type(exception).__name__,
            'message': str(exception),
            "lineNumber": lineNumber
        }
        tb = exception.__traceback__
        while tb is not None:
            frames.append({
                "fileName": tb.tb_frame.f_code.co_filename,
                "methodName": tb.tb_frame.f_code.co_name,
                "lineNumber": tb.tb_lineno
            })
            tb = tb.tb_next

        stacktrace = {
            "frames": frames
        }
        obj["stacktrace"] = stacktrace

        # run only if user agreed to use this feature
        if self.options['captureCodeSnippet'] is True:
            obj = self.getErrorCodeSnippet(obj)

        return obj;
    
    def getUncaughtExceptionStackTrace(self, type, value, traceback):
        frames = [];
        lineNumber = 'N/A'
        if(traceback is not None):
            lineNumber = traceback.tb_lineno
        obj = {
            'type': type,
            'message': value,
            "lineNumber": lineNumber
        }
        tb = traceback
        while tb is not None:
            frames.append({
                "fileName": tb.tb_frame.f_code.co_filename,
                "methodName": tb.tb_frame.f_code.co_name,
                "lineNumber": tb.tb_lineno
            })
            tb = tb.tb_next

        stacktrace = {
            "frames": frames
        }
        obj["stacktrace"] = stacktrace

        # run only if user agreed to use this feature
        if self.options['captureCodeSnippet'] is True:
            obj = self.getErrorCodeSnippet(obj)

        return obj;
    
    def getErrorCodeSnippet(self, errorObj):
        frames = [] 
        if errorObj["stacktrace"]:
            frames = errorObj["stacktrace"]["frames"]

        # get content related to each frame
        contentFrame = [];
        for frame in frames:
            updateFrame = self.getFrameContent(frame)
            # update content of each frame
            self.updateFrameContent(frame)
            contentFrame.append(updateFrame)
        
        errorObj["stacktrace"]["frames"] = frames
        return errorObj

    def getFrameContent(self, frame):
    
        fileName = frame['fileName']

        # try to read the file content and save to frame
        try:
            with open( fileName ) as file:
                frame["sourceFile"] = file.readlines()

        except Exception as error:
            # something terrible went wrog
            sys.stderr.write( "Warning: Could read file")
        
        return frame
    
    def updateFrameContent(self, frame):
        lines = []
        if frame["sourceFile"] is not None:
            lines = frame["sourceFile"]
        localFrame = self.addCodeSnippetToFrame(lines, frame)
        frame = localFrame
        return frame
    
    def addCodeSnippetToFrame(self, lines, frame, linesOfContext = 5):
    
        if len(lines) < 1: return

        lineNumber = 0
        if frame['lineNumber'] is not None:
            lineNumber = frame['lineNumber']

        maxLines = len(lines)
        sourceLine = max(min(maxLines, lineNumber - 1), 0)
        # attach the line before the error
        frame['linesBeforeError'] = self.__getPathOfLines__(lines, max(0, sourceLine - linesOfContext), linesOfContext)
        # attach the line after the error
        frame['linesAfterError'] = self.__getPathOfLines__(
            lines,
            min(sourceLine + 1, maxLines),
            1 + linesOfContext
        )
        # attach the error line
        frame['errorLine'] = lines[min(maxLines - 1, sourceLine)]

        # remove the source file
        del frame['sourceFile']

        return frame
    
    def __getPathOfLines__(self, lines, start, count):
        end = start + count
        return lines[start:end]
    
    