import multer from "multer";
import { RequestHandler } from "express";

// Configure multer for handling multipart/form-data
// Uses memory storage to store files in memory as Buffer objects
const upload: multer.Multer = multer({ storage: multer.memoryStorage() });

// Middleware for handling any file uploads (multipart/form-data)
// This is useful for webhooks that send data as multipart/form-data (e.g., SendGrid inbound email)
export const MultipartFormDataMiddleware: RequestHandler =
  upload.any() as unknown as RequestHandler;

export default upload;
