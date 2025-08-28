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
  SessionMessage,
  SpaceRegistrationState,
  SpaceRegistrationStep
} from "./types";
import type { KVSpaceData } from "./types";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/

// Space registration steps
const SPACE_REGISTRATION_STEPS: SpaceRegistrationStep[] = [
  {
    step: 1,
    field_name: "name",
    description: "공간의 이름",
    required: true,
    example: "예: '홍대 카페', '스튜디오 A'"
  },
  {
    step: 2,
    field_name: "address",
    description: "공간의 주소",
    required: true,
    example: "예: '서울특별시 마포구 홍대로 123'"
  },
  {
    step: 3,
    field_name: "space_type",
    description: "공간 유형",
    required: true,
    example: "예: 'Indoor', 'Outdoor', 'Semi-Private'"
  },
  {
    step: 4,
    field_name: "max_capacity",
    description: "최대 수용 인원",
    required: true,
    example: "예: 10, 20, 50"
  },
  {
    step: 5,
    field_name: "area_size",
    description: "면적 (제곱미터)",
    required: true,
    example: "예: 30, 50, 100"
  },
  {
    step: 6,
    field_name: "amenities",
    description: "시설 및 편의시설",
    required: false,
    example: "예: '전기, 의자, 테이블, 음향시설'"
  },
  {
    step: 7,
    field_name: "fee_policy",
    description: "이용료 정책",
    required: true,
    example: "예: '무료', '시간당 10,000원', '일일 50,000원'"
  },
  {
    step: 8,
    field_name: "opening_hours",
    description: "운영 시간",
    required: true,
    example: "예: '평일 09:00-18:00, 주말 10:00-17:00'"
  }
];

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
 * Get space registration state from KV
 */
async function getSpaceRegistrationState(sessionId: string, env: Env): Promise<SpaceRegistrationState | null> {
  try {
    const stateKey = `space_registration:${sessionId}`;
    const stateData = await env.KV.get(stateKey, "json") as SpaceRegistrationState | null;
    return stateData;
  } catch (error) {
    console.error("Error getting space registration state:", error);
    return null;
  }
}

/**
 * Save space registration state to KV
 */
async function saveSpaceRegistrationState(state: SpaceRegistrationState, env: Env): Promise<void> {
  try {
    const stateKey = `space_registration:${state.session_id}`;
    await env.KV.put(stateKey, JSON.stringify(state));
  } catch (error) {
    console.error("Error saving space registration state:", error);
  }
}

/**
 * Initialize space registration state
 */
async function initializeSpaceRegistration(sessionId: string, env: Env): Promise<SpaceRegistrationState> {
  const state: SpaceRegistrationState = {
    session_id: sessionId,
    step: 1,
    collected_data: {},
    required_fields: SPACE_REGISTRATION_STEPS.map(step => step.field_name),
    last_updated: Date.now()
  };
  
  await saveSpaceRegistrationState(state, env);
  return state;
}

/**
 * Extract structured data from user message using LLM
 */
async function extractSpaceDataFromMessage(
  message: string, 
  currentStep: SpaceRegistrationStep,
  conversationContext: SessionMessage[],
  env: Env
): Promise<{ extracted: any; isValid: boolean; error?: string }> {
  try {
    const contextInfo = conversationContext.length > 0 
      ? `\n\n이전 대화 컨텍스트:\n${conversationContext.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
      : '';

    const extractionPrompt = `
당신은 사용자의 메시지에서 공간 정보를 추출하는 AI입니다.

현재 수집 중인 정보: ${currentStep.description}
필드명: ${currentStep.field_name}
예시: ${currentStep.example}
필수 여부: ${currentStep.required ? '필수' : '선택'}

사용자 메시지: "${message}"${contextInfo}

위 메시지에서 ${currentStep.description}에 해당하는 정보를 추출하여 JSON 형태로 응답해주세요.

응답 형식:
{
  "extracted_value": "추출된 값",
  "is_valid": true/false,
  "error_message": "오류가 있다면 설명"
}

주의사항:
- 숫자 필드(예: max_capacity, area_size)는 숫자로 변환
- 배열 필드(예: amenities)는 쉼표로 구분된 문자열을 배열로 변환
- 운영시간은 구조화된 형태로 변환
- 추출할 수 없거나 부족한 정보가 있으면 is_valid를 false로 설정
`;

    const api_token = env.GOOGLE_AI_STUDIO_TOKEN;
    const account_id = "b227edcf71da28cffe319fe486c42e39";
    const gateway_name = "my-gateway";

    const genAI = new GoogleGenerativeAI(api_token);
    const model = genAI.getGenerativeModel(
      { model: "gemini-1.5-flash" },
      {
        baseUrl: `https://gateway.ai.cloudflare.com/v1/${account_id}/${gateway_name}/google-ai-studio`,
      },
    );

    const result = await model.generateContent(extractionPrompt);
    const response = await result.response;
    const responseText = response.text();
    
    try {
      const parsedResult = JSON.parse(responseText);
      return {
        extracted: parsedResult.extracted_value,
        isValid: parsedResult.is_valid,
        error: parsedResult.error_message
      };
    } catch (parseError) {
      return {
        extracted: null,
        isValid: false,
        error: "응답을 파싱할 수 없습니다."
      };
    }
    
    return {
      extracted: null,
      isValid: false,
      error: "응답을 생성할 수 없습니다."
    };
  } catch (error) {
    console.error("Error extracting space data:", error);
    return {
      extracted: null,
      isValid: false,
      error: "데이터 추출 중 오류가 발생했습니다."
    };
  }
}

/**
 * Generate space ID
 */
async function generateSpaceId(env: Env): Promise<string> {
  try {
    // Get all space keys to find the highest number
    const { keys } = await env.KV.list({ prefix: "space-" });
    let maxNumber = 0;
    
    for (const key of keys) {
      const match = key.name.match(/space-(\d+)/);
      if (match) {
        const number = parseInt(match[1]);
        if (number > maxNumber) {
          maxNumber = number;
        }
      }
    }
    
    return `space-${maxNumber + 1}`;
  } catch (error) {
    console.error("Error generating space ID:", error);
    return `space-${Date.now()}`;
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
    
    // Handle different intents
    let response: IntentAnalysisResponseUpdated;
    
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
      
      response = searchResult;
    } else if (intentType === "ADD_SPACE") {
      const addSpaceResult = await handleAddSpaceFlow(requestBody.message, requestBody.session_id, conversationContext, env);
      
      // Add assistant response to session
      const assistantMessage: SessionMessage = {
        role: "assistant",
        content: addSpaceResult.llm_response,
        intent_type: intentType,
        timestamp: Date.now(),
        metadata: addSpaceResult.is_completed ? {
          space_id: addSpaceResult.space_id
        } : undefined
      };
      await addMessageToSession(requestBody.session_id, assistantMessage, env);
      
      response = addSpaceResult;
    } else {
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
      
      response = {
        status: "SUCCESS",
        intent_type: intentType as "ADD_SPACE" | "CREATE_USER_PROFILE",
        llm_response: llmResponse
      };
    }

    return new Response(JSON.stringify(response), {
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
    const api_token = env.GOOGLE_AI_STUDIO_TOKEN;
    const account_id = "b227edcf71da28cffe319fe486c42e39";
    const gateway_name = "my-gateway";

    const genAI = new GoogleGenerativeAI(api_token);
    const model = genAI.getGenerativeModel(
      { model: "gemini-1.5-flash" },
      {
        baseUrl: `https://gateway.ai.cloudflare.com/v1/${account_id}/${gateway_name}/google-ai-studio`,
      },
    );

    const result = await model.generateContent(intentAnalysisPrompt);
    const response = await result.response;
    const intentResult = response.text().trim().toUpperCase();

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
 * Handles ADD_SPACE flow with step-by-step data collection
 */
async function handleAddSpaceFlow(
  message: string,
  sessionId: string,
  conversationContext: SessionMessage[],
  env: Env
): Promise<{ status: "SUCCESS"; intent_type: "ADD_SPACE"; llm_response: string; is_completed?: boolean; space_id?: string }> {
  try {
    console.log("Starting ADD_SPACE flow");

    // Get or initialize registration state
    let state = await getSpaceRegistrationState(sessionId, env);
    if (!state) {
      state = await initializeSpaceRegistration(sessionId, env);
    }

    const currentStep = SPACE_REGISTRATION_STEPS.find(step => step.step === state.step);
    if (!currentStep) {
      return {
        status: "SUCCESS",
        intent_type: "ADD_SPACE",
        llm_response: "공간 등록 과정에서 오류가 발생했습니다. 다시 시작해주세요."
      };
    }

    // Extract data from user message
    const extractionResult = await extractSpaceDataFromMessage(message, currentStep, conversationContext, env);

    if (extractionResult.isValid && extractionResult.extracted !== null) {
      // Save extracted data
      state.collected_data[currentStep.field_name as keyof KVSpaceData] = extractionResult.extracted;
      state.last_updated = Date.now();

      // Move to next step
      state.step++;

      // Check if all required fields are completed
      const isCompleted = state.step > SPACE_REGISTRATION_STEPS.length;
      
      if (isCompleted) {
        // Save the complete space data to KV
        const spaceId = await generateSpaceId(env);
        const completeSpaceData: KVSpaceData = {
          space_id: spaceId,
          name: state.collected_data.name || "",
          space_type: state.collected_data.space_type || "",
          address: state.collected_data.address || "",
          coordinate: state.collected_data.coordinate || { lat: 0, lng: 0 },
          access_type: "open",
          min_capacity: null,
          max_capacity: state.collected_data.max_capacity || 0,
          area_size: state.collected_data.area_size || 0,
          sensors: { noise: false, cctv: false },
          opening_hours: state.collected_data.opening_hours || {
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
          booking_policy: {
            cancellation: false,
            modification: true,
            reservation_required: false,
            deposit_required: false
          },
          min_mins_per_use: null,
          max_mins_per_use: null,
          fee_policy: state.collected_data.fee_policy || "",
          status: "active",
          last_updated: new Date().toISOString(),
          amenities: state.collected_data.amenities || [],
          accessibility: [],
          memory_narrative: "",
          characteristics: {},
          temporal_pattern: {},
          outcome_affordance: {},
          governance_mode: {},
          norm: {},
          owner_entity: "user"
        };

        await env.KV.put(spaceId, JSON.stringify(completeSpaceData));

        // Clear registration state
        await env.KV.delete(`space_registration:${sessionId}`);

        return {
          status: "SUCCESS",
          intent_type: "ADD_SPACE",
          llm_response: `축하합니다! 공간 등록이 완료되었습니다. 🎉\n\n등록된 공간 정보:\n- 이름: ${completeSpaceData.name}\n- 주소: ${completeSpaceData.address}\n- 유형: ${completeSpaceData.space_type}\n- 수용 인원: ${completeSpaceData.max_capacity}명\n- 면적: ${completeSpaceData.area_size}㎡\n- 이용료: ${completeSpaceData.fee_policy}\n\n공간 ID: ${spaceId}\n\n이제 다른 사용자들이 이 공간을 검색할 수 있습니다. 추가로 수정하고 싶은 정보가 있으시면 언제든 말씀해 주세요!`,
          is_completed: true,
          space_id: spaceId
        };
      } else {
        // Continue to next step
        await saveSpaceRegistrationState(state, env);
        
        const nextStep = SPACE_REGISTRATION_STEPS.find(step => step.step === state.step);
        if (nextStep) {
          return {
            status: "SUCCESS",
            intent_type: "ADD_SPACE",
            llm_response: `좋습니다! ${currentStep.description}이(가) 등록되었습니다.\n\n다음으로 ${nextStep.description}을(를) 알려주세요.\n${nextStep.example}`
          };
        }
      }
    } else {
      // Invalid data, ask for clarification
      await saveSpaceRegistrationState(state, env);
      
      return {
        status: "SUCCESS",
        intent_type: "ADD_SPACE",
        llm_response: `죄송합니다. ${currentStep.description}을(를) 정확히 파악하지 못했습니다.\n\n${currentStep.example}\n\n다시 한 번 알려주시겠어요?`
      };
    }

    return {
      status: "SUCCESS",
      intent_type: "ADD_SPACE",
      llm_response: "공간 등록 과정에서 오류가 발생했습니다. 다시 시작해주세요."
    };
  } catch (error) {
    console.error("Error in handleAddSpaceFlow:", error);
    return {
      status: "SUCCESS",
      intent_type: "ADD_SPACE",
      llm_response: "공간 등록 중 오류가 발생했습니다. 다시 시도해주세요."
    };
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
    
    const api_token = env.GOOGLE_AI_STUDIO_TOKEN;
    const account_id = "b227edcf71da28cffe319fe486c42e39";
    const gateway_name = "my-gateway";

    const genAI = new GoogleGenerativeAI(api_token);
    const model = genAI.getGenerativeModel(
      { model: "gemini-1.5-flash" },
      {
        baseUrl: `https://gateway.ai.cloudflare.com/v1/${account_id}/${gateway_name}/google-ai-studio`,
      },
    );

    const result = await model.generateContent(responsePrompt);
    const response = await result.response;
    return response.text();
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

    const api_token = env.GOOGLE_AI_STUDIO_TOKEN;
    const account_id = "b227edcf71da28cffe319fe486c42e39";
    const gateway_name = "my-gateway";

    const genAI = new GoogleGenerativeAI(api_token);
    const model = genAI.getGenerativeModel(
      { model: "gemini-1.5-flash" },
      {
        baseUrl: `https://gateway.ai.cloudflare.com/v1/${account_id}/${gateway_name}/google-ai-studio`,
      },
    );

    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${responsePrompt}` : responsePrompt;
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    return response.text();
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

