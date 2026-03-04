/**
 * Session Manager
 * Manages MCP sessions and their associated data
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import logger from "Common/Server/Utils/Logger";

// Session data interface
export interface SessionData {
  transport: StreamableHTTPServerTransport;
  apiKey: string;
}

/**
 * SessionManager handles the lifecycle of MCP sessions
 */
export default class SessionManager {
  private static sessions: Map<string, SessionData> = new Map();
  private static currentSessionApiKey: string = "";

  /**
   * Get all active sessions
   */
  public static getSessions(): Map<string, SessionData> {
    return this.sessions;
  }

  /**
   * Check if a session exists
   */
  public static hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get a session by ID
   */
  public static getSession(sessionId: string): SessionData | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Create or update a session
   */
  public static setSession(sessionId: string, data: SessionData): void {
    this.sessions.set(sessionId, data);
    logger.info(`MCP session stored: ${sessionId}`);
  }

  /**
   * Update the API key for an existing session
   */
  public static updateSessionApiKey(
    sessionId: string,
    apiKey: string,
  ): boolean {
    const session: SessionData | undefined = this.sessions.get(sessionId);
    if (session) {
      session.apiKey = apiKey;
      return true;
    }
    return false;
  }

  /**
   * Remove a session
   */
  public static removeSession(sessionId: string): boolean {
    const deleted: boolean = this.sessions.delete(sessionId);
    if (deleted) {
      logger.info(`MCP session removed: ${sessionId}`);
    }
    return deleted;
  }

  /**
   * Get the current session API key (used during request processing)
   */
  public static getCurrentApiKey(): string {
    return this.currentSessionApiKey;
  }

  /**
   * Set the current session API key (called at the start of each request)
   */
  public static setCurrentApiKey(apiKey: string): void {
    this.currentSessionApiKey = apiKey;
  }

  /**
   * Clear the current session API key
   */
  public static clearCurrentApiKey(): void {
    this.currentSessionApiKey = "";
  }

  /**
   * Get the count of active sessions
   */
  public static getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (useful for cleanup)
   */
  public static clearAllSessions(): void {
    this.sessions.clear();
    this.currentSessionApiKey = "";
    logger.info("All MCP sessions cleared");
  }
}
