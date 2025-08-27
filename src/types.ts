/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
  /**
   * Binding for the Workers AI API.
   */
  AI: Ai;

  /**
   * Binding for static assets - TEMPORARILY DISABLED
   */
  // ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Intent analysis request body
 */
export interface IntentAnalysisRequest {
  message: string;
  session_id: string;
}

/**
 * Intent types
 */
export type IntentType = "SEARCH_SPACE" | "ADD_SPACE" | "CREATE_USER_PROFILE";

/**
 * Intent analysis success response
 */
export interface IntentAnalysisSuccessResponse {
  status: "SUCCESS";
  intent_type: IntentType;
}

/**
 * Intent analysis failure response
 */
export interface IntentAnalysisFailureResponse {
  status: "FAILURE";
  error: Array<{
    message: string;
  }>;
}

/**
 * Intent analysis response union type
 */
export type IntentAnalysisResponse = IntentAnalysisSuccessResponse | IntentAnalysisFailureResponse;
