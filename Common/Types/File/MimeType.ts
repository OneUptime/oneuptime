// https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types

enum MimeType {
  aac = "audio/aac",
  png = "image/png",
  jpg = "image/jpeg",
  jpeg = "image/jpeg",
  svg = "image/svg+xml",
  gif = "image/gif",
  webp = "image/webp",
  pdf = "application/pdf",
  doc = "application/msword",
  docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt = "text/plain",
  md = "text/markdown",
  csv = "text/csv",
  rtf = "application/rtf",
  odt = "application/vnd.oasis.opendocument.text",
  json = "application/json",
  zip = "application/zip",
  xls = "application/vnd.ms-excel",
  xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods = "application/vnd.oasis.opendocument.spreadsheet",
  ppt = "application/vnd.ms-powerpoint",
  pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp = "application/vnd.oasis.opendocument.presentation",

  // TODO add more mime types.
}

export default MimeType;
