
from logtype import LogType
import uuid

class Util:

    def __init__(self, options):
        self.options = options
    
    def getErrorType(self):
        return LogType
    
    def v4(self):
        return uuid.uuid4();