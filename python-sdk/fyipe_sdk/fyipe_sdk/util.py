
from fyipe_sdk.fyipe_sdk.logtype import LogType
import uuid

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

        # TODO set up and run only if user agreed to use this feature
        print(obj)
        return obj;