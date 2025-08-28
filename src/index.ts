/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { 
  Env, 
  ChatMessage, 
  IntentAnalysisRequest, 
  IntentAnalysisResponseUpdated, 
  IntentType,
  SearchSpaceSuccessResponse,
  SpaceInfo,
  ChatSession,
  SessionMessage
} from "./types";
import type { KVSpaceData } from "./types";
import Anthropic from "@anthropic-ai/sdk";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Get chat session from KV
 */
async function getChatSession(sessionId: string, env: Env): Promise<ChatSession | null> {
  try {
    const sessionKey = `chat_session:${sessionId}`;
    const sessionData = await env.KV.get(sessionKey, "json") as ChatSession | null;
    return sessionData;
  } catch (error) {
    console.error("Error getting chat session:", error);
    return null;
  }
}

/**
 * Save chat session to KV
 */
async function saveChatSession(session: ChatSession, env: Env): Promise<void> {
  try {
    const sessionKey = `chat_session:${session.session_id}`;
    await env.KV.put(sessionKey, JSON.stringify(session));
  } catch (error) {
    console.error("Error saving chat session:", error);
  }
}

/**
 * Add message to chat session
 */
async function addMessageToSession(
  sessionId: string, 
  message: SessionMessage, 
  env: Env
): Promise<void> {
  try {
    let session = await getChatSession(sessionId, env);
    
    if (!session) {
      // Create new session
      session = {
        session_id: sessionId,
        messages: [],
        last_updated: Date.now(),
        created_at: Date.now()
      };
    }
    
    // Add message to session
    session.messages.push(message);
    session.last_updated = Date.now();
    
    // Keep only last 20 messages to prevent session from getting too large
    if (session.messages.length > 20) {
      session.messages = session.messages.slice(-20);
    }
    
    await saveChatSession(session, env);
  } catch (error) {
    console.error("Error adding message to session:", error);
  }
}

/**
 * Get conversation context for LLM
 */
async function getConversationContext(sessionId: string, env: Env): Promise<SessionMessage[]> {
  try {
    const session = await getChatSession(sessionId, env);
    if (!session) {
      return [];
    }
    
    // Return last 10 messages for context
    return session.messages.slice(-10);
  } catch (error) {
    console.error("Error getting conversation context:", error);
    return [];
  }
}

/**
 * Creates a failure response
 */
function createFailureResponse(errors: Array<{ message: string }>): Response {
  const failureResponse: IntentAnalysisResponseUpdated = {
    status: "FAILURE",
    error: errors,
  };

  return new Response(JSON.stringify(failureResponse), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Get all spaces from KV storage (keys starting with 'space')
 */
async function getAllSpacesFromKV(env: Env): Promise<KVSpaceData[]> {
  try {
    console.log("Fetching all spaces from KV");
    
    // List all keys starting with 'space'
    const { keys } = await env.KV.list();
    console.log(`Found ${keys.length} space keys in KV`);
    
    // Fetch all space data
    const spacePromises = keys.map(async (key) => {
      const data = await env.KV.get(key.name, "json");
      return data as KVSpaceData;
    });
    
    const spaces = await Promise.all(spacePromises);
    const validSpaces = spaces.filter((space): space is KVSpaceData => space !== null);
    
    console.log(`Retrieved ${validSpaces.length} valid spaces from KV`);
    return validSpaces;
  } catch (error) {
    console.error("Error fetching spaces from KV:", error);
    return [];
  }
}

/**
 * Filter spaces based on user message
 */
function filterSpacesByMessage(spaces: KVSpaceData[], message: string): KVSpaceData[] {
  console.log(`Filtering ${spaces.length} spaces based on message: "${message}"`);
  
  // Simple keyword-based filtering
  const lowerMessage = message || '';
  
  return spaces.filter(space => {
    // Check address for location match
    if (lowerMessage.includes("인천") && space.address?.includes("인천")) return true;
    if (lowerMessage.includes("서울") && space.address?.includes("서울")) return true;
    if (lowerMessage.includes("부산") && space.address?.includes("부산")) return true;
    
    // Check amenities for equipment match
    if (lowerMessage.includes("오디오") && space.amenities?.some(a => a?.includes("음향") || a?.includes("오디오"))) return true;
    if (lowerMessage.includes("마이크") && space.amenities?.some(a => a?.includes("마이크"))) return true;
    if (lowerMessage.includes("프로젝터") && space.amenities?.some(a => a?.includes("프로젝터"))) return true;
    
    // Check space type
    if (lowerMessage.includes("실내") && space.space_type?.includes("indoor")) return true;
    if (lowerMessage.includes("야외") && space.space_type?.includes("outdoor")) return true;
    
    // If no specific filters, return all active spaces
    return false;
  });
}

/**
 * Convert KV space data to API response format
 */
function convertKVSpaceToSpaceInfo(kvSpace: KVSpaceData): SpaceInfo {
  return {
    id: parseInt(kvSpace.space_id?.replace(/\D/g, '') || '0') || 0, // Extract number from space_id
    name: kvSpace.name || '',
    space_type: kvSpace.space_type || '',
    address: kvSpace.address || '',
    coordinate: {
      lat: kvSpace.coordinate?.lat || 0,
      lng: kvSpace.coordinate?.lng || 0
    },
    access_type: kvSpace.access_type || '',
    capacity: kvSpace.max_capacity || 0,
    area_size: kvSpace.area_size || 0,
    amenities: kvSpace.amenities || [],
    accessibility: kvSpace.accessibility || [],
    sensors: kvSpace.sensors || { cctv: false, noise: false },
    access_frequency: "보통", // Default value
    status: kvSpace.status || 'active',
    opening_hours: kvSpace.opening_hours || {
      monday: "closed",
      tuesday: "closed", 
      wednesday: "closed",
      thursday: "closed",
      friday: "closed",
      saturday: "closed",
      sunday: "closed",
      holidays: "closed",
      notes: null
    },
    fee_policy: kvSpace.fee_policy || '',
    booking_policy: kvSpace.booking_policy || {
      cancellation: false,
      modification: false,
      reservation_required: false,
      deposit_required: false
    },
    max_mins_per_use: kvSpace.max_mins_per_use || 120,
    min_mins_per_use: kvSpace.min_mins_per_use || 60,
    characteristics: {
      SOCIO_ECOLOGICAL: Object.values(kvSpace.characteristics || {}).flat(),
      MEANING_HOLDING: Object.values(kvSpace.temporal_pattern || {}).flat(),
      CO_HOLDING: Object.values(kvSpace.outcome_affordance || {}).flat(),
      CARE_INVITING: Object.values(kvSpace.governance_mode || {}).flat(),
      RITUAL_HOLDING: Object.values(kvSpace.norm || {}).flat(),
      QUIET_APPRECIATION: [],
      QUIET_COEXISTENCE: [],
      PERMISSION_FLEXIBLE: [],
      JOY_GENERATIVE: [],
      THRESHOLD_SPACE: []
    },
    temporal_pattern: {
      RESTORATION_BOUND: [],
      DAILY_CYCLE: [],
      RITUAL_INTERVAL: [],
      THRESHOLD_ACTIVATED: [],
      POP_UP_COMPATIBLE: []
    },
    outcome_affordance: {
      TRUST_BUILDING: [],
      MENTAL_HEALTH_SUPPORTING: [],
      RESOURCE_SHARING_ENABLING: [],
      CARBON_REDUCING: [],
      STEWARDSHIP_LEARNING: [],
      DIGITAL_TRACEABLE: [],
      CRISIS_BUFFERING: [],
      INTERGENERATIONAL_BRIDGING: [],
      POLICY_INFORMING: []
    },
    governance_mode: {
      PEER_MODERATED: [],
      ROTATING_CUSTODIANSHIP: [],
      YOUTH_LED: [],
      AI_ASSISTED: []
    },
    norms: {
      FACILITY_PRESERVATION: [],
      ATMOSPHERE_MAINTENANCE: [],
      PRE_APPROVAL: [],
      COLLABORATIVE_FEEDBACK: [],
      SPATIAL_CONSIDERATION: []
    },
    rating: 0
  };
}

/**
 * Extract basic filters from user message
 */
function extractFiltersFromMessage(message: string): any {
  const filters: any = {};
  const lowerMessage = message || '';
  
  // Extract location
  if (lowerMessage.includes("인천")) filters.address = "인천광역시";
  if (lowerMessage.includes("서울")) filters.address = "서울특별시";
  if (lowerMessage.includes("부산")) filters.address = "부산광역시";
  
  // Extract amenities
  const amenities = [];
  if (lowerMessage.includes("오디오")) amenities.push("오디오");
  if (lowerMessage.includes("마이크")) amenities.push("마이크");
  if (lowerMessage.includes("프로젝터")) amenities.push("프로젝터");
  if (amenities.length > 0) filters.amenities = amenities;
  
  return filters;
}

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

    // Add user message to session
    const userMessage: SessionMessage = {
      role: "user",
      content: requestBody.message,
      timestamp: Date.now()
    };
    await addMessageToSession(requestBody.session_id, userMessage, env);

    // Get conversation context
    const conversationContext = await getConversationContext(requestBody.session_id, env);

    // Analyze intent using LLM with context
    const intentType = await analyzeIntentWithLLM(requestBody.message, conversationContext, env);
    
    // Handle SEARCH_SPACE intent with Claude-4-Sonnet MCP call
    if (intentType === "SEARCH_SPACE") {
      const searchResult = await handleSearchSpaceFlow(requestBody.message, requestBody.session_id, conversationContext, env);
      
      // Add assistant response to session
      const assistantMessage: SessionMessage = {
        role: "assistant",
        content: searchResult.llm_response,
        intent_type: intentType,
        timestamp: Date.now(),
        metadata: {
          search_results: searchResult.data
        }
      };
      await addMessageToSession(requestBody.session_id, assistantMessage, env);
      
      return new Response(JSON.stringify(searchResult), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    
    // Handle other intents with LLM response
    const llmResponse = await generateIntentResponse(intentType, requestBody.message, conversationContext, env);
    
    // Add assistant response to session
    const assistantMessage: SessionMessage = {
      role: "assistant",
      content: llmResponse,
      intent_type: intentType,
      timestamp: Date.now()
    };
    await addMessageToSession(requestBody.session_id, assistantMessage, env);
    
    const successResponse: IntentAnalysisResponseUpdated = {
      status: "SUCCESS",
      intent_type: intentType,
      llm_response: llmResponse,
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
async function analyzeIntentWithLLM(message: string, conversationContext: SessionMessage[], env: Env): Promise<IntentType> {
  // Build context from conversation history
  const contextInfo = conversationContext.length > 0 
    ? `\n\n이전 대화 컨텍스트:\n${conversationContext.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
    : '';

  const intentAnalysisPrompt = `
당신은 사용자의 메시지를 분석하여 의도를 파악하는 AI입니다.
다음 3가지 의도 중 하나로 분류해주세요:

1. SEARCH_SPACE: 공간을 찾거나 검색하려는 의도 (예: "홍대 근처 카페 찾아줘", "4명이서 갈 수 있는 식당")
2. ADD_SPACE: 새로운 공간을 등록하거나 추가하려는 의도 (예: "우리 카페 등록하고 싶어", "새로운 장소 추가")  
3. CREATE_USER_PROFILE: 사용자 프로필을 생성하거나 수정하려는 의도 (예: "프로필 만들기", "내 정보 수정")

현재 사용자 메시지: "${message}"${contextInfo}

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
    try {
      if (typeof response === "string") {
        intentResult = String(response).trim().toUpperCase();
      } else if (response && typeof response === "object") {
        const responseObj = response as Record<string, any>;
        if (responseObj.response && typeof responseObj.response === "string") {
          intentResult = String(responseObj.response).trim().toUpperCase();
        }
      }
    } catch (error) {
      console.warn("Error processing LLM response:", error);
      intentResult = "";
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
 * Handles SEARCH_SPACE flow with Cloudflare KV
 */
async function handleSearchSpaceFlow(
  message: string,
  sessionId: string,
  conversationContext: SessionMessage[],
  env: Env
): Promise<SearchSpaceSuccessResponse> {
  try {
    console.log("Starting KV-based space search flow");

    // Get all space data from KV
    const spaceData = await getAllSpacesFromKV(env);
    
    // Filter spaces based on user message (basic filtering)
    const filteredSpaces = filterSpacesByMessage(spaceData, message);
    
    console.log(`Found ${filteredSpaces.length} spaces matching criteria`);

    // Convert KV space data to API response format
    const responseSpaces = filteredSpaces.map(convertKVSpaceToSpaceInfo);
    
    // Generate LLM response based on search results
                    const toolResults: Omit<SearchSpaceSuccessResponse, 'llm_response' | 'search_context'> = {
                  status: "SUCCESS",
                  intent_type: "SEARCH_SPACE",
                  data: responseSpaces,
                  total_count: responseSpaces.length
                };
    
    const llmResponse = await generateSearchResultResponse(message, toolResults, conversationContext, env);
    
    // Add LLM response to the result
                    return {
                  status: "SUCCESS",
                  intent_type: "SEARCH_SPACE",
                  data: toolResults.data,
                  total_count: toolResults.total_count,
                  llm_response: llmResponse
                };
  } catch (error) {
    console.error("Error in handleSearchSpaceFlow:", error);
    
    // Return empty result on error
    return {
      status: "SUCCESS",
      intent_type: "SEARCH_SPACE",
      data: [],
      total_count: 0,
      search_context: {
        filters_used: {},
        result_count: 0,
        search_mode: "ERROR",
        excluded_spaces: []
      },
      llm_response: "죄송합니다. 공간 검색 중 오류가 발생했습니다. 다시 시도해주세요."
    };
  }
}


/**
 * Generate LLM response for search results
 */
async function generateSearchResultResponse(
  originalMessage: string,
  searchResult: Omit<SearchSpaceSuccessResponse, 'llm_response' | 'search_context'>,
  conversationContext: SessionMessage[],
  env: Env
): Promise<string> {
  try {
    // Build context from conversation history
    const contextInfo = conversationContext.length > 0 
      ? `\n\n이전 대화 컨텍스트:\n${conversationContext.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
      : '';

    let responsePrompt = "";
    
    if (searchResult.data.length > 0) {
      const spaces = searchResult.data.map(space => 
        `- ${space.name} (${space.address}): ${space.amenities.join(', ')} 이용 가능`
      ).join('\n');
      
      responsePrompt = `사용자 요청: "${originalMessage}"

검색 결과 ${searchResult.total_count}개의 공간을 찾았습니다:
${spaces}${contextInfo}

위 검색 결과를 바탕으로 사용자에게 친근하고 도움이 되는 응답을 작성해주세요. 
이전 대화 컨텍스트를 고려하여 연속적인 대화가 자연스럽게 이어지도록 해주세요.
공간의 특징과 이용 방법을 간단히 설명하고, 추가 질문이 있으면 언제든 물어보라고 안내해주세요.`;
    } else {
      responsePrompt = `사용자 요청: "${originalMessage}"

검색 결과 조건에 맞는 공간을 찾지 못했습니다.${contextInfo}

사용자에게 죄송하다는 말과 함께 다른 조건으로 다시 검색해보거나, 
더 구체적인 요구사항을 알려달라고 친근하게 요청하는 응답을 작성해주세요.
이전 대화 컨텍스트를 고려하여 연속적인 대화가 자연스럽게 이어지도록 해주세요.`;
    }
    
    const apiKey = env.ANTHROPIC_API_KEY;
    const accountId = "b227edcf71da28cffe319fe486c42e39"; // 실제 account_id로 교체 필요
    const gatewayId = "my-gateway"; // 실제 gateway_id로 교체 필요
    const baseURL = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/anthropic`;

    console.log(apiKey);
    const anthropic = new Anthropic({
      apiKey,
      baseURL,
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: responsePrompt
        }
      ],
      max_tokens: 1024,
    });

    const content = response.content[0];
    if (content && 'text' in content) {
      return content.text;
    }
    return "응답을 생성할 수 없습니다.";
  } catch (error) {
    console.error("Error generating search response:", error);
    
    if (searchResult.data.length > 0) {
      return `${searchResult.total_count}개의 공간을 찾았습니다! 첫 번째 추천 공간은 "${searchResult.data[0].name}"입니다. 더 자세한 정보가 필요하시면 언제든 말씀해 주세요.`;
    } else {
      return "죄송합니다. 요청하신 조건에 맞는 공간을 찾지 못했습니다. 다른 지역이나 조건으로 다시 검색해보시겠어요?";
    }
  }
}

/**
 * Generate LLM response for other intents
 */
async function generateIntentResponse(
  intentType: IntentType,
  message: string,
  conversationContext: SessionMessage[],
  env: Env
): Promise<string> {
  try {
    // Build context from conversation history
    const contextInfo = conversationContext.length > 0 
      ? `\n\n이전 대화 컨텍스트:\n${conversationContext.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
      : '';

    let systemPrompt = "";
    let responsePrompt = "";

    switch (intentType) {
      case "ADD_SPACE":
        systemPrompt = "당신은 공간 등록을 도와주는 친근한 도우미입니다.";
        responsePrompt = `사용자가 새로운 공간을 등록하고 싶어합니다: "${message}"${contextInfo}

공간 등록 절차를 안내하고, 필요한 정보(공간명, 주소, 시설, 연락처 등)를 
단계별로 친근하게 요청하는 응답을 작성해주세요.
이전 대화 컨텍스트를 고려하여 연속적인 대화가 자연스럽게 이어지도록 해주세요.`;
        break;
        
      case "CREATE_USER_PROFILE":
        systemPrompt = "당신은 사용자 프로필 생성을 도와주는 친근한 도우미입니다.";
        responsePrompt = `사용자가 프로필을 만들고 싶어합니다: "${message}"${contextInfo}

프로필 생성 과정을 안내하고, 필요한 정보(이름, 관심사, 선호하는 공간 타입 등)를 
단계별로 친근하게 요청하는 응답을 작성해주세요.
이전 대화 컨텍스트를 고려하여 연속적인 대화가 자연스럽게 이어지도록 해주세요.`;
        break;
        
      default:
        return "안녕하세요! 무엇을 도와드릴까요?";
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    const accountId = "your_account_id"; // 실제 account_id로 교체 필요
    const gatewayId = "your_gateway_id"; // 실제 gateway_id로 교체 필요
    const baseURL = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/anthropic`;

    const anthropic = new Anthropic({
      apiKey,
      baseURL,
    });

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: responsePrompt
        }
      ],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const content = response.content[0];
    if (content && 'text' in content) {
      return content.text;
    }
    return "응답을 생성할 수 없습니다.";
  } catch (error) {
    console.error("Error generating intent response:", error);
    
    switch (intentType) {
      case "ADD_SPACE":
        return "새로운 공간을 등록해주셔서 감사합니다! 공간 등록을 위해 몇 가지 정보가 필요합니다. 공간의 이름과 주소부터 알려주시겠어요?";
      case "CREATE_USER_PROFILE":
        return "프로필 생성을 도와드리겠습니다! 먼저 사용하실 이름을 알려주시겠어요?";
      default:
        return "안녕하세요! 무엇을 도와드릴까요?";
    }
  }
}

