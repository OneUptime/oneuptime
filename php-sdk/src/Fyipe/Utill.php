<?php

/**
 * @author bunday
 */

namespace Fyipe;

use stdClass;

class Util
{
    public function getErrorType()
    {
        $types = new stdClass;
        $types->info = 'info';
        $types->warning = 'warning';
        $types->error = 'error';
        return $types;
    }

    public function getErrorStackTrace($errno, $errstr, $errfile, $errline)
    {

        $type = 'UNKNOWN ERROR';
        switch ($errno) {
            case 1:
                $type = 'E_ERROR';
            case 2:
                $type = 'E_WARNING';
            case 8:
                $type = 'E_NOTICE';
            case 256:
                $type = 'E_USER_ERROR';
            case 512:
                $type = 'E_USER_WARNING';
            case 1024:
                $type = 'E_USER_NOTICE';
            case 2048:
                $type = 'E_STRICT';
            case 8191:
                $type = 'E_ALL';
            default:
                $type = 'UNKNOWN ERROR';
        }

        $frames = [];
        $obj = new stdClass();
        $obj->type = $type;
        $obj->message = $errstr;
        $obj->lineNumber = $errline;
        $frame = [
            'methodName' => explode(":", $errstr, 2)[0],
            'lineNumber' => $errline,
            'fileName' => $errfile,
        ];
        array_push($frames, $frame);
        $stacktrace = new stdClass();
        $stacktrace->frames = $frames;
        $obj->stacktrace = $stacktrace;

        return $obj;
    }

    public function getExceptionStackTrace($exception)
    {
    
      $frames = [];
      $obj = new stdClass();
      $obj->type = get_class($exception);
      $obj->message = $exception->getMessage();
      $obj->lineNumber = $exception->getLine();
    
      for ($cursor = 0; $cursor < sizeof($exception->getTrace()); $cursor++) {
        $currentFrame = $exception->getTrace()[$cursor];
    
        $frameData = [
          'methodName' => $currentFrame['class'] . '->' . $currentFrame['function'],
          'lineNumber' => $currentFrame['line'],
          'fileName' => $currentFrame['file'],
        ];
        array_push($frames, $frameData);
      }
      $stacktrace = new stdClass();
      $stacktrace->frames = $frames;
      $obj->stacktrace = $stacktrace;
    
      return $obj;
    }
}
