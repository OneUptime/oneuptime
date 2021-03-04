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
      $obj->type = is_string($exception) ? $exception : get_class($exception);
      $obj->message =  is_string($exception) ? $exception : $exception->getMessage();
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
    public static function v4() {
        return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
    
          // 32 bits for "time_low"
          mt_rand(0, 0xffff), mt_rand(0, 0xffff),
    
          // 16 bits for "time_mid"
          mt_rand(0, 0xffff),
    
          // 16 bits for "time_hi_and_version",
          // four most significant bits holds version number 4
          mt_rand(0, 0x0fff) | 0x4000,
    
          // 16 bits, 8 bits for "clk_seq_hi_res",
          // 8 bits for "clk_seq_low",
          // two most significant bits holds zero and one for variant DCE1.1
          mt_rand(0, 0x3fff) | 0x8000,
    
          // 48 bits for "node"
          mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
        );
      }
}
