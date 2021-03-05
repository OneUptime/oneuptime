<?php

/**
 * @author bunday
 */

namespace Fyipe;

use stdClass;

class Util
{
    private $CONTENT_CACHE;
    private $options;

    public function __construct($options)
    {
        $this->CONTENT_CACHE = new \LRUCache\LRUCache(100);
        $this->options = $options;
    }
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

        // run only if user agreed to use this feature
        if($this->options['captureCodeSnippet']) {
            $obj = $this->getErrorCodeSnippet($obj);
        }
        return $obj;
    }
    private function getErrorCodeSnippet($errorObj)
    {
        $frames = $errorObj->stacktrace ? $errorObj->stacktrace->frames : [];

        // get content related to each frame
        $frames = array_map(array('self', 'getFrameContent'), $frames);

        // update content of each frame
        $frames = array_map(array('self', 'updateFrameContent'), $frames);
        $errorObj->stacktrace->frames = $frames;
        return $errorObj;
    }
    private function formatFileName($fileName)
    {
        $fileIndicator = 'file://';
        $localFileName = $fileName;
        if (strpos($fileName, $fileIndicator) > -1) {
            // check for index of file then trim the file part by skiping it and starting with the leading /
            $localFileName = substr($fileName, strpos($fileName, $fileIndicator) + strlen($fileIndicator));
        }
        return $localFileName;
    }
    private function getFrameContent($frame)
    {
        $fileName = $frame['fileName'];
        // check what it starts with
        $fileName = $this->formatFileName($fileName);

        // try to get the file from the cache
        $cache = $this->CONTENT_CACHE->get($fileName);
        // if we get a hit for the file
        if (isset($cache)) {
            // and the content is not null
            if (!is_null($cache)) {
                $frame['sourceFile'] = $cache;
            }
        } else {
            // try to read the file content and save to cache
            $currentContent =  $this->readFileFromSource($fileName);
            if (!is_null($currentContent)) {
                $frame['sourceFile'] = $currentContent;
            }
        }
        return $frame;
    }
    private function readFileFromSource($fileName)
    {
        // var_dump($fileName);
        $content = file_get_contents($fileName);
        // var_dump($content);
        // $content = json_decode($content, true);

        $this->CONTENT_CACHE->put($fileName, $content);
        return $content;
    }
    private function updateFrameContent($frame)
    {
        $lines = $frame['sourceFile'] ? explode("\n", $frame['sourceFile']) : [];
        $localFrame = $this->addCodeSnippetToFrame($lines, $frame);
        $frame = $localFrame;
        return $frame;
    }
    private function addCodeSnippetToFrame($lines, $frame, $linesOfContext = 5)
    {
        if (sizeof($lines) < 1) return;
        $lineNumber = $frame['lineNumber'] ? $frame['lineNumber'] : 0;
        $maxLines = sizeof($lines);
        $sourceLine = max(min($maxLines, $lineNumber - 1), 0);
        // attach the line before the error
        $frame['linesBeforeError'] = array_slice($lines, max(0, $sourceLine - $linesOfContext), $linesOfContext);
        // attach the line after the error
        $frame['linesAfterError'] = array_slice(
            $lines,
            min($sourceLine + 1, $maxLines),
            1 + $linesOfContext
        );
        // attach the error line
        $frame['errorLine'] = $lines[min($maxLines - 1, $sourceLine)];

        // remove the source file
        unset($frame['sourceFile']);

        return $frame;
    }

    public static function v4()
    {
        return sprintf(
            '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',

            // 32 bits for "time_low"
            mt_rand(0, 0xffff),
            mt_rand(0, 0xffff),

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
            mt_rand(0, 0xffff),
            mt_rand(0, 0xffff),
            mt_rand(0, 0xffff)
        );
    }
}
