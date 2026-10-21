/*
 * Clipboard contents the MarkdownEditor's paste handler has to read, as real
 * applications put them on the clipboard. Used by MarkdownPaste.test.ts and
 * MarkdownEditor.test.tsx.
 */

/*
 * text/html that Outlook put on the clipboard for the body of issue #4114
 * ("Improved Copy and Paste Handling") -- the report itself was pasted from
 * it, nested lists and all. The <body> is verbatim. The <head> is shortened:
 * Word's latent-style XML (one conditional comment of ~600 lines) is cut to
 * its first block, and the <link>s to files in the copier's temp folder are
 * left out.
 */
export const WORD_OUTLOOK_ISSUE_4114_HTML: string = `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"
xmlns="http://www.w3.org/TR/REC-html40">

<head>

<meta name=ProgId content=Word.Document>
<meta name=Generator content="Microsoft Word 15">
<meta name=Originator content="Microsoft Word 15">
<!--[if !mso]>
<style>
v\\:* {behavior:url(#default#VML);}
o\\:* {behavior:url(#default#VML);}
w\\:* {behavior:url(#default#VML);}
.shape {behavior:url(#default#VML);}
</style>
<![endif]-->
<!--[if gte mso 9]><xml>
 <o:OfficeDocumentSettings>
  <o:AllowPNG/>
 </o:OfficeDocumentSettings>
</xml><![endif]-->

</head>

<body lang=EN-CA style='tab-interval:36.0pt;word-wrap:break-word'>
<!--StartFragment-->

<p class=MsoNormal><b>Is your feature request related to a problem? Please
describe.<o:p></o:p></b></p>

<p class=MsoNormal>With the new custom fields available on incident requests,
we would like to further enhance how these fields are used with templates.<o:p></o:p></p>

<p class=MsoNormal>Currently, not every incident requires the same information.
Different incident/message templates may require different fields, and some
fields may need to be mandatory for one template but optional or completely
hidden for another.<o:p></o:p></p>

<p class=MsoNormal>Ideally, the template should determine exactly what
information the incident submitter needs to provide. The user should not have
to look through a large list of available custom fields and determine which
ones are relevant to the particular incident.<o:p></o:p></p>

<p class=MsoNormal>For example, one template may require:<o:p></o:p></p>

<ul style='margin-top:0cm' type=disc>
 <li class=MsoNormal style='mso-list:l5 level1 lfo1;tab-stops:list 36.0pt'>Status<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l5 level1 lfo1;tab-stops:list 36.0pt'>Severity<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l5 level1 lfo1;tab-stops:list 36.0pt'>Affected
     Location<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l5 level1 lfo1;tab-stops:list 36.0pt'>Start
     Time<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l5 level1 lfo1;tab-stops:list 36.0pt'>Impact<o:p></o:p></li>
</ul>

<p class=MsoNormal>while another template may only require:<o:p></o:p></p>

<ul style='margin-top:0cm' type=disc>
 <li class=MsoNormal style='mso-list:l1 level1 lfo2;tab-stops:list 36.0pt'>Status<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l1 level1 lfo2;tab-stops:list 36.0pt'>Affected
     Location<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l1 level1 lfo2;tab-stops:list 36.0pt'>Expected
     Resolution<o:p></o:p></li>
</ul>

<p class=MsoNormal>The template should be able to tailor the form accordingly.<o:p></o:p></p>

<p class=MsoNormal><b>Describe the solution you'd like<o:p></o:p></b></p>

<p class=MsoNormal><b>Template-Specific Custom Fields<o:p></o:p></b></p>

<p class=MsoNormal>When creating or editing a message template, administrators
should be able to configure each available custom field as:<o:p></o:p></p>

<ul style='margin-top:0cm' type=disc>
 <li class=MsoNormal style='mso-list:l6 level1 lfo3;tab-stops:list 36.0pt'><b>Shown
     / Hidden</b><o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l6 level1 lfo3;tab-stops:list 36.0pt'><b>Required
     / Optional</b><o:p></o:p></li>
</ul>

<p class=MsoNormal>This configuration would be specific to the template.<o:p></o:p></p>

<p class=MsoNormal>For example:<o:p></o:p></p>


Custom Field | Template A | Template B
-- | -- | --
Status | Required | Required
Severity | Required | Hidden
Affected Location | Required | Required
Start Time | Required | Optional
Expected Resolution | Optional | Required
Additional Information | Optional | Hidden



<p class=MsoNormal>This would allow administrators to build templates that are
tailored to specific types of incidents or communications.<o:p></o:p></p>

<p class=MsoNormal>The goal is that when a user selects a template, they are
presented with <b>only the fields relevant to that template</b>, with required
fields clearly identified and enforced.<o:p></o:p></p>

<p class=MsoNormal>This would make the process more intuitive and reduce the
possibility of users submitting incomplete or unnecessary information.<o:p></o:p></p>

<div class=MsoNormal align=center style='text-align:center'>

<hr size=2 width="100%" align=center>

</div>

<p class=MsoNormal><b>Markdown Editor Enhancements<o:p></o:p></b></p>

<p class=MsoNormal>If a WYSIWYG editor is not possible, some additional
improvements to the existing Markdown editor would be very helpful.<o:p></o:p></p>

<p class=MsoNormal><b>Indent / Nested List Button<o:p></o:p></b></p>

<p class=MsoNormal>The Markdown editor supports nested bullet points, but there
is currently no visual control for creating them.<o:p></o:p></p>

<p class=MsoNormal>Adding an <b>Indent</b> button would allow users to indent
selected text or create a nested bullet point.<o:p></o:p></p>

<p class=MsoNormal>For example:<o:p></o:p></p>

<ul style='margin-top:0cm' type=disc>
 <li class=MsoNormal style='mso-list:l2 level1 lfo4;tab-stops:list 36.0pt'>Main
     item<o:p></o:p></li>
 <ul style='margin-top:0cm' type=circle>
  <li class=MsoNormal style='mso-list:l2 level2 lfo4;tab-stops:list 72.0pt'>Nested
      item<o:p></o:p></li>
  <ul style='margin-top:0cm' type=square>
   <li class=MsoNormal style='mso-list:l2 level3 lfo4;tab-stops:list 108.0pt'>Further
       nested item<o:p></o:p></li>
  </ul>
 </ul>
</ul>

<p class=MsoNormal>The underlying Markdown already supports this; the
enhancement would simply provide an easier visual/editor control for creating
them.<o:p></o:p></p>

<p class=MsoNormal><b>Improved Copy and Paste Handling<o:p></o:p></b></p>

<p class=MsoNormal>It would also be helpful for the Markdown editor to better
preserve formatting when copying and pasting content.<o:p></o:p></p>

<p class=MsoNormal>Multiple users may use the same template, but the actual
content of each incident can be similar to a previous submission with only
minor changes.<o:p></o:p></p>

<p class=MsoNormal>For example, a previous incident might contain:<o:p></o:p></p>

<ul style='margin-top:0cm' type=disc>
 <li class=MsoNormal style='mso-list:l3 level1 lfo5;tab-stops:list 36.0pt'>Service
     is currently unavailable<o:p></o:p></li>
 <ul style='margin-top:0cm' type=circle>
  <li class=MsoNormal style='mso-list:l3 level2 lfo5;tab-stops:list 72.0pt'>Users
      are unable to log in<o:p></o:p></li>
  <li class=MsoNormal style='mso-list:l3 level2 lfo5;tab-stops:list 72.0pt'>Users
      are receiving an error message<o:p></o:p></li>
 </ul>
 <li class=MsoNormal style='mso-list:l3 level1 lfo5;tab-stops:list 36.0pt'>Investigation
     is in progress<o:p></o:p></li>
 <ul style='margin-top:0cm' type=circle>
  <li class=MsoNormal style='mso-list:l3 level2 lfo5;tab-stops:list 72.0pt'>Technical
      team has been notified<o:p></o:p></li>
  <li class=MsoNormal style='mso-list:l3 level2 lfo5;tab-stops:list 72.0pt'>Vendor
      has been contacted<o:p></o:p></li>
 </ul>
</ul>

<p class=MsoNormal>A user may want to copy this content into a new incident and
simply change a few details.<o:p></o:p></p>

<p class=MsoNormal>Currently, if the formatting is not preserved properly, the
user may have to manually recreate the formatting. (Currently a pasted bullet
may show the dot visually, but markdown does not apply the bullet formatting
and nested lists become flat. Attempting to fix this with visual controls
created double bullet icons.) <br>
For example, they may have to:<o:p></o:p></p>

<ul style='margin-top:0cm' type=disc>
 <li class=MsoNormal style='mso-list:l4 level1 lfo6;tab-stops:list 36.0pt'>Recreate
     the bullet points<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l4 level1 lfo6;tab-stops:list 36.0pt'>Re-indent
     nested bullet points<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l4 level1 lfo6;tab-stops:list 36.0pt'>Reapply
     the correct nesting to each item<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l4 level1 lfo6;tab-stops:list 36.0pt'>Recreate
     or re-link web links<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l4 level1 lfo6;tab-stops:list 36.0pt'>Reapply
     other supported Markdown formatting<o:p></o:p></li>
</ul>

<p class=MsoNormal>This becomes particularly cumbersome when copying a larger
formatted message.<o:p></o:p></p>

<p class=MsoNormal>Ideally, copying and pasting content from a previous
incident or message would preserve the existing Markdown formatting, including:<o:p></o:p></p>

<ul style='margin-top:0cm' type=disc>
 <li class=MsoNormal style='mso-list:l0 level1 lfo7;tab-stops:list 36.0pt'>Bullet-point
     lists<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l0 level1 lfo7;tab-stops:list 36.0pt'>Nested
     bullet points<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l0 level1 lfo7;tab-stops:list 36.0pt'>Numbered
     lists<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l0 level1 lfo7;tab-stops:list 36.0pt'>Indentation<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l0 level1 lfo7;tab-stops:list 36.0pt'>Links
     and URLs<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l0 level1 lfo7;tab-stops:list 36.0pt'>Basic
     text formatting<o:p></o:p></li>
 <li class=MsoNormal style='mso-list:l0 level1 lfo7;tab-stops:list 36.0pt'>Other
     supported Markdown formatting<o:p></o:p></li>
</ul>

<p class=MsoNormal>For example, if a user copies a previously formatted list
containing nested bullets and links, the pasted content should retain that
structure rather than requiring the user to manually style, indent, and relink
each item again.<o:p></o:p></p>

<p class=MsoNormal>This would be especially useful when a new incident is very
similar to a previous incident and only requires a few changes to the existing
message.<o:p></o:p></p>

<p class=MsoNormal><b>Additional Context<o:p></o:p></b></p>

<p class=MsoNormal>The overall goal is to make templates more <b>purpose-built
and user-friendly</b>.<o:p></o:p></p>

<p class=MsoNormal>Ideally, an administrator creates a template and determines:<o:p></o:p></p>

<p class=MsoNormal><b>Which fields are displayed → Which fields are required →
What the message looks like</b><o:p></o:p></p>

<p class=MsoNormal>Then, when a user selects that template, they only need to
provide the information relevant to that specific type of incident.<o:p></o:p></p>

<p class=MsoNormal>The Markdown improvements would further reduce the amount of
repetitive formatting required when users create similar incident messages,
while the template-specific fields would ensure that users are only asked for
information relevant to that particular type of incident.<o:p></o:p></p>

<p class=MsoNormal><o:p>&nbsp;</o:p></p>

<!--EndFragment-->
</body>

</html>
`;

/*
 * What Chromium puts on the clipboard for a MarkdownViewer rendering of
 * VIEWER_COPY_SOURCE_MARKDOWN (below), selected whole and copied with
 * Ctrl+C: captured from a paste event in Chromium 1243 (headless shell),
 * with the real MarkdownViewer bundled by the repo's esbuild config. Chromium
 * writes every top-level element's computed style inline; the Tailwind
 * "--tw-*" custom properties in those styles are removed here for size, and
 * everything else is verbatim -- including the node="[object Object]"
 * attributes the viewer renders today.
 */
export const CHROME_VIEWER_COPY_HTML: string = `<p class="text-sm mt-2 mb-1 text-gray-700 leading-relaxed" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); margin: 0.5rem 0px 0.25rem; font-size: 0.875rem; line-height: 1.625; color: rgb(55, 65, 81); font-family: ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;">Update at <time datetime="2026-04-20T11:21:00.000Z" title="2026-04-20T11:21:00.000Z (UTC)" class="text-xs px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-800 font-mono whitespace-nowrap" style="box-sizing: border-box; border-width: 1px; border-style: solid; border-color: rgb(229, 231, 235); white-space: nowrap; border-radius: 0.25rem; background-color: rgb(243, 244, 246); padding: 0.125rem 0.375rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, &quot;Liberation Mono&quot;, &quot;Courier New&quot;, monospace; font-size: 0.75rem; line-height: 1rem; color: rgb(31, 41, 55);">Apr 20 2026, 11:21:00 AM GMT</time>:</p><ul class="list-disc pl-6 mt-0 mb-1" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); list-style: disc; margin: 0px 0px 0.25rem; padding: 0px 0px 0px 1.5rem; color: rgb(0, 0, 0); font-family: ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: medium; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); margin-bottom: 0.25rem; margin-top: 0.25rem; font-size: 0.875rem; line-height: 1.625; color: rgb(55, 65, 81);">Service is currently unavailable<ul class="list-[circle] pl-6 mt-0 mb-1" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); list-style: circle; margin: 0px 0px 0.25rem; padding: 0px 0px 0px 1.5rem;"><li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); margin-bottom: 0.25rem; margin-top: 0.25rem; font-size: 0.875rem; line-height: 1.625; color: rgb(55, 65, 81);">Users are <strong class="text-sm font-semibold text-gray-900" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-weight: 600; font-size: 0.875rem; line-height: 1.25rem; color: rgb(17, 24, 39);">unable</strong> to log in<ul class="list-[square] pl-6 mt-0 mb-1" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); list-style: square; margin: 0px 0px 0.25rem; padding: 0px 0px 0px 1.5rem;"><li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); margin-bottom: 0.25rem; margin-top: 0.25rem; font-size: 0.875rem; line-height: 1.625; color: rgb(55, 65, 81);">See the <a class="underline text-blue-600 hover:text-blue-800 font-medium transition-colors" href="https://status.example.com/incidents?id=1" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(37, 99, 235); text-decoration-line: underline; text-decoration-thickness: inherit; text-decoration-style: inherit; text-decoration-color: inherit; font-weight: 500; transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, -webkit-text-decoration-color; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;">status page</a></li></ul></li></ul></li><li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); margin-bottom: 0.25rem; margin-top: 0.25rem; font-size: 0.875rem; line-height: 1.625; color: rgb(55, 65, 81);">Investigation is in progress</li></ul><ol class="list-decimal pl-6 mt-0 mb-1" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); list-style: decimal; margin: 0px 0px 0.25rem; padding: 0px 0px 0px 1.5rem; color: rgb(0, 0, 0); font-family: ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: medium; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); margin-bottom: 0.25rem; margin-top: 0.25rem; font-size: 0.875rem; line-height: 1.625; color: rgb(55, 65, 81);">First step</li><li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); margin-bottom: 0.25rem; margin-top: 0.25rem; font-size: 0.875rem; line-height: 1.625; color: rgb(55, 65, 81);">Second step</li></ol><div class="relative rounded-lg mt-3 mb-3 overflow-hidden border border-gray-200 shadow-sm" data-markdown-code-block="true" data-language="typescript" style="box-sizing: border-box; border-width: 1px; border-style: solid; border-color: rgb(229, 231, 235); position: relative; margin-bottom: 0.75rem; margin-top: 0.75rem; overflow: hidden; border-radius: 0.5rem; box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px; color: rgb(0, 0, 0); font-family: ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: medium; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><div class="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700" data-markdown-ignore="true" style="box-sizing: border-box; border-width: 0px 0px 1px; border-style: solid; border-color: rgb(55, 65, 81); display: flex; align-items: center; justify-content: space-between; background-color: rgb(31, 41, 55); padding: 0.375rem 0.75rem;"><button class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-all duration-150 border-none cursor-pointer text-gray-400 hover:text-gray-200 hover:bg-white/10" aria-label="Copy code" type="button" style="box-sizing: border-box; border-width: 0px; border-style: none; border-color: rgb(229, 231, 235); font-family: inherit; font-feature-settings: inherit; font-variation-settings: inherit; font-size: 11px; font-weight: 500; line-height: inherit; letter-spacing: inherit; color: rgb(156, 163, 175); margin: 0px; padding: 0.125rem 0.5rem; text-transform: none; appearance: button; background-color: transparent; background-image: none; cursor: pointer; display: inline-flex; align-items: center; gap: 0.375rem; border-radius: 0.25rem; transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>Copy</button></div><div node="[object Object]" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="box-sizing: border-box; border-width: 0px !important; border-style: solid; border-color: rgb(229, 231, 235); margin: 0.5em 0px; border-radius: 0px !important; background: rgb(30, 30, 30); padding: 1em; font-size: 13px; line-height: 1.5; color: rgb(212, 212, 212); text-shadow: none; font-family: Menlo, Monaco, Consolas, &quot;Andale Mono&quot;, &quot;Ubuntu Mono&quot;, &quot;Courier New&quot;, monospace; direction: ltr; text-align: left; white-space: pre; word-spacing: normal; word-break: normal; tab-size: 4; hyphens: none; overflow: auto;"><code class="font-mono" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, &quot;Liberation Mono&quot;, &quot;Courier New&quot;, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 1em; white-space: pre;"><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(86, 156, 214);">const</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); "> x </span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(212, 212, 212);">=</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); "> </span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(181, 206, 168);">1</span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(212, 212, 212);">;</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); ">
</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); "></span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(86, 156, 214);">const</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); "> y </span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(212, 212, 212);">=</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); "> </span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(181, 206, 168);">2</span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(212, 212, 212);">;</span></code></div></div><blockquote class="rounded-lg border border-amber-200 bg-amber-50/50 my-4 not-italic overflow-hidden" node="[object Object]" style="box-sizing: border-box; border-width: 1px; border-style: solid; border-color: rgb(253, 230, 138); margin: 1rem 0px; overflow: hidden; border-radius: 0.5rem; background-color: rgba(255, 251, 235, 0.5); font-style: normal; color: rgb(0, 0, 0); font-family: ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: medium; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><div class="flex items-start gap-3 px-4 py-3" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.75rem 1rem;"><svg class="h-5 w-5 flex-shrink-0 text-amber-500 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"></path></svg><div class="text-sm text-gray-700 leading-relaxed [&amp;&gt;p]:mt-0 [&amp;&gt;p]:mb-0 [&amp;&gt;p&gt;strong:first-child]:text-amber-700 [&amp;&gt;p&gt;strong:first-child]:mr-1" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-size: 0.875rem; line-height: 1.625; color: rgb(55, 65, 81);"><p class="text-sm mt-2 mb-1 text-gray-700 leading-relaxed" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); margin: 0px; font-size: 0.875rem; line-height: 1.625; color: rgb(55, 65, 81);">Quoted <em style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); ">text</em></p></div></div></blockquote><ul class="contains-task-list" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); list-style: none; margin: 0px; padding: 0px; color: rgb(0, 0, 0); font-family: ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: medium; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><li class="task-list-item" node="[object Object]" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); "><input type="checkbox" disabled="" aria-label="done item" checked="" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-family: inherit; font-feature-settings: inherit; font-variation-settings: inherit; font-size: 16px; font-weight: inherit; line-height: inherit; letter-spacing: inherit; color: inherit; margin: 0px; padding: 0px; cursor: default;"> done item</li></ul>`;

export const CHROME_VIEWER_COPY_TEXT: string =
  "Update at Apr 20 2026, 11:21:00 AM GMT:\n\nService is currently unavailable\nUsers are unable to log in\nSee the status page\nInvestigation is in progress\nFirst step\nSecond step\nCopy\nconst x = 1;\nconst y = 2;\nQuoted text\n\n done item";

/*
 * The same copy in Firefox 1543 (Playwright build), verbatim. Firefox keeps
 * the source's line breaks and indentation between elements and writes no
 * computed styles; its plain text indents nested items by four spaces but
 * drops their bullets.
 */
export const FIREFOX_VIEWER_COPY_HTML: string = `<div class="max-w-none"><p class="text-sm mt-2 mb-1 text-gray-700 leading-relaxed" node="[object Object]">Update at <time datetime="2026-04-20T11:21:00.000Z" title="2026-04-20T11:21:00.000Z (UTC)" class="text-xs px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-800 font-mono whitespace-nowrap">Apr 20 2026, 11:21:00 AM GMT</time>:</p>
<ul class="list-disc pl-6 mt-0 mb-1" node="[object Object]">
<li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]">Service is currently unavailable
<ul class="list-[circle] pl-6 mt-0 mb-1" node="[object Object]">
<li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]">Users are <strong class="text-sm font-semibold text-gray-900" node="[object Object]">unable</strong> to log in
<ul class="list-[square] pl-6 mt-0 mb-1" node="[object Object]">
<li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]">See the <a class="underline text-blue-600 hover:text-blue-800 font-medium transition-colors" href="https://status.example.com/incidents?id=1" node="[object Object]">status page</a></li>
</ul>
</li>
</ul>
</li>
<li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]">Investigation is in progress</li>
</ul>
<ol class="list-decimal pl-6 mt-0 mb-1" node="[object Object]">
<li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]">First step</li>
<li class="text-sm mt-1 mb-1 text-gray-700 leading-relaxed" node="[object Object]">Second step</li>
</ol>
<div class="relative rounded-lg mt-3 mb-3 overflow-hidden border border-gray-200 shadow-sm" data-markdown-code-block="true" data-language="typescript"><div class="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700" data-markdown-ignore="true"><button class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-all duration-150 border-none cursor-pointer text-gray-400 hover:text-gray-200 hover:bg-white/10" aria-label="Copy code" type="button"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"></svg>Copy</button></div><div node="[object Object]" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="color: rgb(212, 212, 212); font-size: 13px; text-shadow: none; font-family: Menlo, Monaco, Consolas, &quot;Andale Mono&quot;, &quot;Ubuntu Mono&quot;, &quot;Courier New&quot;, monospace; direction: ltr; text-align: left; white-space: pre; word-spacing: normal; word-break: normal; line-height: 1.5; tab-size: 4; hyphens: none; padding: 1em; margin: 0.5em 0px; overflow: auto; background: rgb(30, 30, 30);"><code class="font-mono" style="white-space: pre;"><span class="token" style="color: rgb(86, 156, 214);">const</span><span> x </span><span class="token" style="color: rgb(212, 212, 212);">=</span><span> </span><span class="token" style="color: rgb(181, 206, 168);">1</span><span class="token" style="color: rgb(212, 212, 212);">;</span><span>
</span><span></span><span class="token" style="color: rgb(86, 156, 214);">const</span><span> y </span><span class="token" style="color: rgb(212, 212, 212);">=</span><span> </span><span class="token" style="color: rgb(181, 206, 168);">2</span><span class="token" style="color: rgb(212, 212, 212);">;</span></code></div></div>
<blockquote class="rounded-lg border border-amber-200 bg-amber-50/50 my-4 not-italic overflow-hidden" node="[object Object]"><div class="flex items-start gap-3 px-4 py-3"><svg class="h-5 w-5 flex-shrink-0 text-amber-500 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"></svg><div class="text-sm text-gray-700 leading-relaxed [&amp;&gt;p]:mt-0 [&amp;&gt;p]:mb-0 [&amp;&gt;p&gt;strong:first-child]:text-amber-700 [&amp;&gt;p&gt;strong:first-child]:mr-1">
<p class="text-sm mt-2 mb-1 text-gray-700 leading-relaxed" node="[object Object]">Quoted <em>text</em></p>
</div></div></blockquote>
<ul class="contains-task-list" node="[object Object]">
<li class="task-list-item" node="[object Object]"><input type="checkbox" disabled="disabled" aria-label="done item" checked="checked"> done item</li>
</ul></div>`;

export const FIREFOX_VIEWER_COPY_TEXT: string =
  "Update at Apr 20 2026, 11:21:00 AM GMT:\n\n    Service is currently unavailable\n        Users are unable to log in\n            See the status page\n    Investigation is in progress\n\n    First step\n    Second step\n\nCopy\nconst x = 1;\nconst y = 2;\n\n    Quoted text\n\n    done item\n";

// The markdown the viewer rendered for the two copies above.
export const VIEWER_COPY_SOURCE_MARKDOWN: string = [
  "Update at `2026-04-20T11:21:00.000Z`:",
  "",
  "- Service is currently unavailable",
  "  - Users are **unable** to log in",
  "    - See the [status page](https://status.example.com/incidents?id=1)",
  "- Investigation is in progress",
  "",
  "1. First step",
  "2. Second step",
  "",
  "```typescript",
  "const x = 1;",
  "const y = 2;",
  "```",
  "",
  "> Quoted *text*",
  "",
  "- [x] done item",
].join("\n");

// The inline styles Google Docs writes on every list item and text run.
const DOCS_ITEM_STYLE: string =
  "list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;";
const docsRun: (overrides: string) => string = (overrides: string): string => {
  return `font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;${overrides}white-space:pre;white-space:pre-wrap;`;
};
const DOCS_PARAGRAPH: string =
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">';

/*
 * A bulleted list as Google Docs puts it on the clipboard, modelled on a
 * live copy from Docs in Chromium 153 (September 2026); the text is made
 * up. The whole copy sits in a docs-internal-guid <b>; every <li> ends its
 * style with "white-space:pre;", each item's text is in a <p>, formatting
 * is written as span styles, a nested list sits straight inside its parent
 * <ul>, and a tab is Chromium's <span class="Apple-tab-span">.
 */
export const GOOGLE_DOCS_LIST_COPY_HTML: string = [
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-6a0c3f1e-7fff-4d21-9c3b-0e5d2a8b7c41">',
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">',
  `<span style="${docsRun("font-weight:700;")}">Owner:</span>`,
  `<span style="${docsRun("")}"><span class="Apple-tab-span" style="white-space:pre;">\t</span>Payments on-call</span></p>`,
  '<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">',
  `<li dir="ltr" style="${DOCS_ITEM_STYLE}" aria-level="1">${DOCS_PARAGRAPH}`,
  `<span style="${docsRun("")}">Checkout errors from 09:40 UTC, see </span>`,
  `<a href="https://status.example.com/incidents/42" style="text-decoration:none;"><span style="${docsRun("color:#1155cc;text-decoration:underline;")}">the status page</span></a></p></li>`,
  '<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">',
  `<li dir="ltr" style="${DOCS_ITEM_STYLE.replace("disc", "circle")}" aria-level="2">${DOCS_PARAGRAPH}`,
  `<span style="${docsRun("font-style:italic;")}">Card payments only</span></p></li></ul>`,
  `<li dir="ltr" style="${DOCS_ITEM_STYLE}" aria-level="1">${DOCS_PARAGRAPH}`,
  `<span style="${docsRun("text-decoration:line-through;")}">Rolled back release 3.2</span></p></li></ul>`,
  "</b>",
].join("");

// Docs' plain text for the same copy: the lines alone, no bullets, no indent.
export const GOOGLE_DOCS_LIST_COPY_TEXT: string =
  "Owner:\tPayments on-call\nCheckout errors from 09:40 UTC, see the status page\nCard payments only\nRolled back release 3.2";

// The markdown that copy is.
export const GOOGLE_DOCS_LIST_COPY_MARKDOWN: string = [
  "**Owner:** Payments on-call",
  "",
  "- Checkout errors from 09:40 UTC, see [the status page](https://status.example.com/incidents/42)",
  "  - *Card payments only*",
  "- ~~Rolled back release 3.2~~",
].join("\n");

/*
 * Two lines of a MarkdownViewer code block (```yaml, the lines
 * "replicas: 3" and "image: api_server:v2"), selected on their own and
 * copied with Ctrl+C: what Chromium 1243 and Firefox 1543 put on the
 * clipboard, captured from a paste event with the real viewer bundled by
 * the repo's esbuild config. Neither keeps the block's <div> -- only the
 * <pre> around the selected text, which carries the viewer's hints. The
 * Tailwind "--tw-*" custom properties are removed from Chromium's computed
 * styles for size; everything else is verbatim.
 */
export const CHROME_VIEWER_CODE_LINES_COPY_HTML: string =
  '<pre node="[object Object]" data-markdown-code-block="true" data-language="yaml" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="box-sizing: border-box; border-width: 0px !important; border-style: solid; border-color: rgb(229, 231, 235); font-family: Menlo, Monaco, Consolas, &quot;Andale Mono&quot;, &quot;Ubuntu Mono&quot;, &quot;Courier New&quot;, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 13px; margin: 0.5em 0px; border-radius: 0px !important; background: rgb(30, 30, 30); padding: 1em; line-height: 1.5; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-indent: 0px; text-transform: none; widows: 2; word-spacing: normal; -webkit-text-stroke-width: 0px; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial; color: rgb(212, 212, 212); text-shadow: none; direction: ltr; text-align: left; white-space: pre; word-break: normal; tab-size: 4; hyphens: none; overflow: auto;"><code class="font-mono" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, &quot;Liberation Mono&quot;, &quot;Courier New&quot;, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 1em; white-space: pre;"><span class="token key" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(206, 145, 120);">replicas</span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(212, 212, 212);">:</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); "> </span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(181, 206, 168);">3</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); ">\n</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); "></span><span class="token key" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(206, 145, 120);">image</span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(212, 212, 212);">:</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); "> api_server</span><span class="token" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(212, 212, 212);">:</span><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); ">v2</span></code></pre>';

export const FIREFOX_VIEWER_CODE_LINES_COPY_HTML: string =
  '<pre node="[object Object]" data-markdown-code-block="true" data-language="yaml" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="color: rgb(212, 212, 212); font-size: 13px; text-shadow: none; font-family: Menlo, Monaco, Consolas, &quot;Andale Mono&quot;, &quot;Ubuntu Mono&quot;, &quot;Courier New&quot;, monospace; direction: ltr; text-align: left; white-space: pre; word-spacing: normal; word-break: normal; line-height: 1.5; tab-size: 4; hyphens: none; padding: 1em; margin: 0.5em 0px; overflow: auto; background: rgb(30, 30, 30);"><code class="font-mono" style="white-space: pre;"><span></span><span></span><span class="token key" style="color: rgb(206, 145, 120);">replicas</span><span class="token" style="color: rgb(212, 212, 212);">:</span><span> </span><span class="token" style="color: rgb(181, 206, 168);">3</span><span>\n</span><span></span><span class="token key" style="color: rgb(206, 145, 120);">image</span><span class="token" style="color: rgb(212, 212, 212);">:</span><span> api_server</span><span class="token" style="color: rgb(212, 212, 212);">:</span><span>v2</span></code></pre>';

// The plain text both browsers put beside it.
export const VIEWER_CODE_LINES_COPY_TEXT: string =
  "replicas: 3\nimage: api_server:v2";

/*
 * Four lines of YAML, "metadata:" to "    app: api", selected with a mouse
 * drag in a code view drawn as a table -- the markup of the Dashboard's
 * Kubernetes YAML tab (KubernetesYamlTab.tsx): a row per line, holding a
 * select-none line number and a "whitespace-pre" code cell -- and copied
 * with Ctrl+C: what Chromium 1243 and WebKit 2359 (Safari's engine) put on
 * the clipboard, captured from a paste event. The line numbers stay out of
 * the copy, and both write the code cell's "white-space: pre" on every cell
 * they copy. The Tailwind "--tw-*" custom properties are removed from the
 * computed styles for size; everything else is verbatim.
 */
export const CHROME_CODE_VIEW_TABLE_COPY_HTML: string =
  '<table class="w-full" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: inherit; text-indent: 0px; border-collapse: collapse; width: 1246px; color: rgb(0, 0, 0); font-family: ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: medium; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><tbody style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><tr class="hover:bg-gray-100/50" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><td class="px-4 py-0 text-sm font-mono whitespace-pre" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); white-space: pre; padding: 0px 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, &quot;Liberation Mono&quot;, &quot;Courier New&quot;, monospace; font-size: 0.875rem; line-height: 1.25rem;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><span class="text-indigo-700 font-medium" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-weight: 500; color: rgb(67, 56, 202);">metadata</span><span class="text-gray-500" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(107, 114, 128);">:</span></span></td></tr><tr class="hover:bg-gray-100/50" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><td class="px-4 py-0 text-sm font-mono whitespace-pre" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); white-space: pre; padding: 0px 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, &quot;Liberation Mono&quot;, &quot;Courier New&quot;, monospace; font-size: 0.875rem; line-height: 1.25rem;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);">  <span class="text-indigo-700 font-medium" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-weight: 500; color: rgb(67, 56, 202);">name</span><span class="text-gray-500" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(107, 114, 128);">: </span><span class="text-emerald-700" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(4, 120, 87);">api</span></span></td></tr><tr class="hover:bg-gray-100/50" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><td class="px-4 py-0 text-sm font-mono whitespace-pre" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); white-space: pre; padding: 0px 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, &quot;Liberation Mono&quot;, &quot;Courier New&quot;, monospace; font-size: 0.875rem; line-height: 1.25rem;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);">  <span class="text-indigo-700 font-medium" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-weight: 500; color: rgb(67, 56, 202);">labels</span><span class="text-gray-500" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(107, 114, 128);">:</span></span></td></tr><tr class="hover:bg-gray-100/50" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); background-color: rgba(243, 244, 246, 0.5);"><td class="px-4 py-0 text-sm font-mono whitespace-pre" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); white-space: pre; padding: 0px 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, &quot;Liberation Mono&quot;, &quot;Courier New&quot;, monospace; font-size: 0.875rem; line-height: 1.25rem;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);">    <span class="text-indigo-700 font-medium" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-weight: 500; color: rgb(67, 56, 202);">app</span><span class="text-gray-500" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(107, 114, 128);">: </span><span class="text-emerald-700" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(4, 120, 87);">api</span></span></td></tr></tbody></table>';

export const WEBKIT_CODE_VIEW_TABLE_COPY_HTML: string =
  '<table class="w-full" style="font-size: medium; font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; text-decoration: none; box-sizing: border-box; border-width: 0px; border-style: solid; border-color: inherit; text-indent: 0px; border-collapse: collapse; width: 1246px; color: rgb(0, 0, 0); font-family: ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji; -webkit-tap-highlight-color: rgba(0, 0, 0, 0); background-color: rgb(249, 250, 251);"><tbody style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><tr class="hover:bg-gray-100/50" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><td class="px-4 py-0 text-sm font-mono whitespace-pre" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); white-space: pre; padding: 0px 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace; font-size: 0.875rem; line-height: 1.25rem;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><span class="text-indigo-700 font-medium" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-weight: 500; color: rgb(67 56 202 / var(--tw-text-opacity));">metadata</span><span class="text-gray-500" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(107 114 128 / var(--tw-text-opacity));">:</span></span></td></tr><tr class="hover:bg-gray-100/50" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><td class="px-4 py-0 text-sm font-mono whitespace-pre" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); white-space: pre; padding: 0px 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace; font-size: 0.875rem; line-height: 1.25rem;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);">  <span class="text-indigo-700 font-medium" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-weight: 500; color: rgb(67 56 202 / var(--tw-text-opacity));">name</span><span class="text-gray-500" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(107 114 128 / var(--tw-text-opacity));">: </span><span class="text-emerald-700" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(4 120 87 / var(--tw-text-opacity));">api</span></span></td></tr><tr class="hover:bg-gray-100/50" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><td class="px-4 py-0 text-sm font-mono whitespace-pre" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); white-space: pre; padding: 0px 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace; font-size: 0.875rem; line-height: 1.25rem;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);">  <span class="text-indigo-700 font-medium" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-weight: 500; color: rgb(67 56 202 / var(--tw-text-opacity));">labels</span><span class="text-gray-500" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(107 114 128 / var(--tw-text-opacity));">:</span></span></td></tr><tr class="hover:bg-gray-100/50" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);"><td class="px-4 py-0 text-sm font-mono whitespace-pre" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); white-space: pre; padding: 0px 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace; font-size: 0.875rem; line-height: 1.25rem;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);">    <span class="text-indigo-700 font-medium" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-weight: 500; color: rgb(67 56 202 / var(--tw-text-opacity));">app</span><span class="text-gray-500" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(107 114 128 / var(--tw-text-opacity));">: </span><span class="text-emerald-700" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); color: rgb(4 120 87 / var(--tw-text-opacity));">api</span></span></td></tr></tbody></table>';

// The plain text both browsers put beside it.
export const CODE_VIEW_TABLE_COPY_TEXT: string =
  "metadata:\n  name: api\n  labels:\n    app: api";

/*
 * Less than a line of a MarkdownViewer code block -- a block without a
 * language holding "kubectl get pods -n prod" and "restart api_server now" --
 * copied with Ctrl+C: "api_server" double-clicked, and "kubectl get pods"
 * dragged over with the mouse. What Chromium 1243, Firefox 1543 and WebKit
 * 2359 put on the clipboard, captured from a paste event with the real
 * viewer. Every one of them keeps the viewer's hinted <pre> around even a
 * word. The Tailwind "--tw-*" custom properties are removed from the computed
 * styles for size; everything else is verbatim.
 */
export const CHROME_VIEWER_CODE_WORD_COPY_HTML: string =
  '<pre node="[object Object]" data-markdown-code-block="true" data-language="text" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="box-sizing: border-box; border-width: 0px !important; border-style: solid; border-color: rgb(229, 231, 235); font-family: Menlo, Monaco, Consolas, &quot;Andale Mono&quot;, &quot;Ubuntu Mono&quot;, &quot;Courier New&quot;, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 13px; margin: 0.5em 0px; border-radius: 0px !important; background: rgb(30, 30, 30); padding: 1em; line-height: 1.5; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-indent: 0px; text-transform: none; widows: 2; word-spacing: normal; -webkit-text-stroke-width: 0px; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial; color: rgb(212, 212, 212); text-shadow: none; direction: ltr; text-align: left; white-space: pre; word-break: normal; tab-size: 4; hyphens: none; overflow: auto;"><code class="font-mono" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, &quot;Liberation Mono&quot;, &quot;Courier New&quot;, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 1em; white-space: pre;">api_server</code></pre>';

export const FIREFOX_VIEWER_CODE_WORD_COPY_HTML: string =
  '<pre node="[object Object]" data-markdown-code-block="true" data-language="text" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="color: rgb(212, 212, 212); font-size: 13px; text-shadow: none; font-family: Menlo, Monaco, Consolas, &quot;Andale Mono&quot;, &quot;Ubuntu Mono&quot;, &quot;Courier New&quot;, monospace; direction: ltr; text-align: left; white-space: pre; word-spacing: normal; word-break: normal; line-height: 1.5; tab-size: 4; hyphens: none; padding: 1em; margin: 0.5em 0px; overflow: auto; background: rgb(30, 30, 30);"><code class="font-mono" style="white-space: pre;">api_server</code></pre>';

export const WEBKIT_VIEWER_CODE_WORD_COPY_HTML: string =
  '<pre node="[object Object]" data-markdown-code-block="true" data-language="text" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-indent: 0px; text-transform: none; widows: 2; word-spacing: normal; -webkit-text-stroke-width: 0px; text-decoration: none; box-sizing: border-box; border-style: solid; border-color: rgb(229, 231, 235); font-family: Menlo, Monaco, Consolas, Andale Mono, Ubuntu Mono, Courier New, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 13px; margin: 0.5em 0px; background: rgb(30, 30, 30); padding: 1em; line-height: 1.5; -webkit-tap-highlight-color: rgba(0, 0, 0, 0); color: rgb(212, 212, 212); text-shadow: none; direction: ltr; text-align: left; white-space: pre; word-break: normal; tab-size: 4; hyphens: none; overflow: auto; border-width: 0px !important; border-radius: 0px !important;"><code class="font-mono" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 1em; white-space: pre;">api_server</code></pre>';

export const CHROME_VIEWER_CODE_PART_OF_LINE_COPY_HTML: string =
  '<pre node="[object Object]" data-markdown-code-block="true" data-language="text" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="box-sizing: border-box; border-width: 0px !important; border-style: solid; border-color: rgb(229, 231, 235); font-family: Menlo, Monaco, Consolas, &quot;Andale Mono&quot;, &quot;Ubuntu Mono&quot;, &quot;Courier New&quot;, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 13px; margin: 0.5em 0px; border-radius: 0px !important; background: rgb(30, 30, 30); padding: 1em; line-height: 1.5; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-indent: 0px; text-transform: none; widows: 2; word-spacing: normal; -webkit-text-stroke-width: 0px; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial; color: rgb(212, 212, 212); text-shadow: none; direction: ltr; text-align: left; white-space: pre; word-break: normal; tab-size: 4; hyphens: none; overflow: auto;"><code class="font-mono" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, &quot;Liberation Mono&quot;, &quot;Courier New&quot;, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 1em; white-space: pre;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);">kubectl get pods</span></code></pre>';

export const FIREFOX_VIEWER_CODE_PART_OF_LINE_COPY_HTML: string =
  '<pre node="[object Object]" data-markdown-code-block="true" data-language="text" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="color: rgb(212, 212, 212); font-size: 13px; text-shadow: none; font-family: Menlo, Monaco, Consolas, &quot;Andale Mono&quot;, &quot;Ubuntu Mono&quot;, &quot;Courier New&quot;, monospace; direction: ltr; text-align: left; white-space: pre; word-spacing: normal; word-break: normal; line-height: 1.5; tab-size: 4; hyphens: none; padding: 1em; margin: 0.5em 0px; overflow: auto; background: rgb(30, 30, 30);"><code class="font-mono" style="white-space: pre;"><span>kubectl get pods</span></code></pre>';

export const WEBKIT_VIEWER_CODE_PART_OF_LINE_COPY_HTML: string =
  '<pre node="[object Object]" data-markdown-code-block="true" data-language="text" class="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0" style="font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-indent: 0px; text-transform: none; widows: 2; word-spacing: normal; -webkit-text-stroke-width: 0px; text-decoration: none; box-sizing: border-box; border-style: solid; border-color: rgb(229, 231, 235); font-family: Menlo, Monaco, Consolas, Andale Mono, Ubuntu Mono, Courier New, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 13px; margin: 0.5em 0px; background: rgb(30, 30, 30); padding: 1em; line-height: 1.5; -webkit-tap-highlight-color: rgba(0, 0, 0, 0); color: rgb(212, 212, 212); text-shadow: none; direction: ltr; text-align: left; white-space: pre; word-break: normal; tab-size: 4; hyphens: none; overflow: auto; border-width: 0px !important; border-radius: 0px !important;"><code class="font-mono" style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 1em; white-space: pre;"><span style="box-sizing: border-box; border-width: 0px; border-style: solid; border-color: rgb(229, 231, 235);">kubectl get pods</span></code></pre>';
