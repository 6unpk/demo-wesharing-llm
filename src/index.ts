/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage, IntentAnalysisRequest, IntentAnalysisResponse, IntentType } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Default system prompt
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle static assets (frontend) - TEMPORARILY DISABLED
    // if (url.pathname === "/" || (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/llm/"))) {
    //   return env.ASSETS.fetch(request);
    // }
    
    // Return API server message for root path
    if (url.pathname === "/") {
      return new Response("API Server - Only /llm/analyze-intent endpoint is available", { 
        status: 200,
        headers: { "content-type": "text/plain" }
      });
    }

    // API Routes - CHAT API TEMPORARILY DISABLED
    // if (url.pathname === "/api/chat") {
    //   // Handle POST requests for chat
    //   if (request.method === "POST") {
    //     return handleChatRequest(request, env);
    //   }

    //   // Method not allowed for other request types
    //   return new Response("Method not allowed", { status: 405 });
    // }

    // Intent analysis API route
    if (url.pathname === "/llm/analyze-intent") {
      // Handle POST requests for intent analysis
      if (request.method === "POST") {
        return handleIntentAnalysisRequest(request, env);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    // Handle 404 for unmatched routes
    return new Response("API Server - Only /llm/analyze-intent endpoint is available", { 
      status: 404,
      headers: { "content-type": "text/plain" }
    });
  },
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests - TEMPORARILY DISABLED
 */
// async function handleChatRequest(
//   request: Request,
//   env: Env,
// ): Promise<Response> {
//   try {
//     // Parse JSON request body
//     const { messages = [] } = (await request.json()) as {
//       messages: ChatMessage[];
//     };

//     // Add system prompt if not present
//     if (!messages.some((msg) => msg.role === "system")) {
//       messages.unshift({ role: "system", content: SYSTEM_PROMPT });
//     });

//     const response = await env.AI.run(
//       MODEL_ID,
//       {
//         messages,
//         max_tokens: 1024,
//       },
//       {
//         returnRawResponse: true,
//         // Uncomment to use AI Gateway
//         // gateway: {
//         //   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
//         //   skipCache: false,      // Set to true to bypass cache
//         //   cacheTtl: 3600,        // Cache time-to-live in seconds
//         // },
//       },
//     );

//     // Return streaming response
//     return response;
//   } catch (error) {
//     console.error("Error processing chat request:", error);
//     return new Response(
//       JSON.stringify({ error: "Failed to process request" }),
//       {
//         status: 500,
//         headers: { "content-type": "application/json" },
//       },
//     );
//   }
// }

/**
 * Handles intent analysis API requests
 */
async function handleIntentAnalysisRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Parse JSON request body
    const requestBody = (await request.json()) as IntentAnalysisRequest;
    
    // Validate request body
    const validationError = validateIntentAnalysisRequest(requestBody);
    if (validationError) {
      return createFailureResponse([{ message: validationError }]);
    }

    // Analyze intent using LLM
    const intentType = await analyzeIntentWithLLM(requestBody.message, env);
    
    // Return success response
    const successResponse: IntentAnalysisResponse = {
      status: "SUCCESS",
      intent_type: intentType,
    };

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing intent analysis request:", error);
    return createFailureResponse([{ message: "Failed to process intent analysis request" }]);
  }
}

/**
 * Validates intent analysis request body
 */
function validateIntentAnalysisRequest(requestBody: any): string | null {
  if (!requestBody) {
    return "Request body is required";
  }

  if (!requestBody.message || typeof requestBody.message !== "string") {
    return "Message is required and must be a string";
  }

  if (requestBody.message.trim().length === 0) {
    return "Message cannot be empty";
  }

  if (!requestBody.session_id || typeof requestBody.session_id !== "string") {
    return "Session ID is required and must be a string";
  }

  return null;
}

/**
 * Analyzes intent using LLM
 */
async function analyzeIntentWithLLM(message: string, env: Env): Promise<IntentType> {
  const intentAnalysisPrompt = `
당신은 사용자의 메시지를 분석하여 의도를 파악하는 AI입니다.
다음 3가지 의도 중 하나로 분류해주세요:

1. SEARCH_SPACE: 공간을 찾거나 검색하려는 의도 (예: "홍대 근처 카페 찾아줘", "4명이서 갈 수 있는 식당")
2. ADD_SPACE: 새로운 공간을 등록하거나 추가하려는 의도 (예: "우리 카페 등록하고 싶어", "새로운 장소 추가")  
3. CREATE_USER_PROFILE: 사용자 프로필을 생성하거나 수정하려는 의도 (예: "프로필 만들기", "내 정보 수정")

사용자 메시지: "${message}"

위 메시지를 분석하여 SEARCH_SPACE, ADD_SPACE, CREATE_USER_PROFILE 중 하나만 응답해주세요. 다른 텍스트는 포함하지 마세요.
`;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "당신은 의도 분석 전문가입니다. 주어진 메시지를 정확히 분류하여 응답해주세요.",
    },
    {
      role: "user", 
      content: intentAnalysisPrompt,
    },
  ];

  try {
    const response = await env.AI.run(MODEL_ID, {
      messages,
      max_tokens: 50,
      temperature: 0.1, // Low temperature for consistent classification
    });

    let intentResult = "";
    if (typeof response === "string") {
      intentResult = response.trim().toUpperCase();
    } else if (response && typeof response === "object" && "response" in response) {
      intentResult = (response as any).response.trim().toUpperCase();
    }

    // Validate and return intent type
    if (intentResult.includes("SEARCH_SPACE")) {
      return "SEARCH_SPACE";
    } else if (intentResult.includes("ADD_SPACE")) {
      return "ADD_SPACE";
    } else if (intentResult.includes("CREATE_USER_PROFILE")) {
      return "CREATE_USER_PROFILE";
    } else {
      // Default to SEARCH_SPACE if classification is unclear
      console.warn(`Unclear intent classification: ${intentResult}, defaulting to SEARCH_SPACE`);
      return "SEARCH_SPACE";
    }
  } catch (error) {
    console.error("Error in LLM intent analysis:", error);
    // Default to SEARCH_SPACE on error
    return "SEARCH_SPACE";
  }
}

/**
 * Creates a failure response
 */
function createFailureResponse(errors: Array<{ message: string }>): Response {
  const failureResponse: IntentAnalysisResponse = {
    status: "FAILURE",
    error: errors,
  };

  return new Response(JSON.stringify(failureResponse), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
