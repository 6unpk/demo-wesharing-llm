/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
  /**
   * Binding for the Workers AI API.
   */
  AI: Ai;

  /**
   * Anthropic API Key for Claude-4-Sonnet MCP calls
   */
  ANTHROPIC_API_KEY: string;



  /**
   * KV Namespace for space data storage
   */
  KV: KVNamespace;

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

/**
 * Space information types for SEARCH_SPACE response
 */
export interface SpaceCoordinate {
  lat: number;
  lng: number;
}

export interface SpaceOpeningHours {
  notes?: string | null;
  friday: string;
  monday: string;
  sunday: string;
  tuesday: string;
  holidays: string;
  saturday: string;
  thursday: string;
  wednesday: string;
}

export interface SpaceBookingPolicy {
  cancellation: boolean;
  modification: boolean;
  deposit_required: boolean;
  reservation_required: boolean;
}

export interface SpaceSensors {
  cctv: boolean;
  noise: boolean;
}

export interface SpaceCharacteristics {
  SOCIO_ECOLOGICAL?: string[];
  MEANING_HOLDING?: string[];
  CO_HOLDING?: string[];
  CARE_INVITING?: string[];
  RITUAL_HOLDING?: string[];
  QUIET_APPRECIATION?: string[];
  QUIET_COEXISTENCE?: string[];
  PERMISSION_FLEXIBLE?: string[];
  JOY_GENERATIVE?: string[];
  THRESHOLD_SPACE?: string[];
}

export interface SpaceTemporalPattern {
  RESTORATION_BOUND?: string[];
  DAILY_CYCLE?: string[];
  RITUAL_INTERVAL?: string[];
  THRESHOLD_ACTIVATED?: string[];
  POP_UP_COMPATIBLE?: string[];
  MULTI_PROGRAMMED?: string[];
  IDLING_POTENTIAL?: string[];
}

export interface SpaceOutcomeAffordance {
  TRUST_BUILDING?: string[];
  MENTAL_HEALTH_SUPPORTING?: string[];
  RESOURCE_SHARING_ENABLING?: string[];
  CARBON_REDUCING?: string[];
  STEWARDSHIP_LEARNING?: string[];
  DIGITAL_TRACEABLE?: string[];
  CRISIS_BUFFERING?: string[];
  INTERGENERATIONAL_BRIDGING?: string[];
  POLICY_INFORMING?: string[];
}

export interface SpaceGovernanceMode {
  PEER_MODERATED?: string[];
  ROTATING_CUSTODIANSHIP?: string[];
  YOUTH_LED?: string[];
  AI_ASSISTED?: string[];
  CARETAKER_ALLIANCE?: string[];
}

export interface SpaceNorms {
  FACILITY_PRESERVATION?: string[];
  ATMOSPHERE_MAINTENANCE?: string[];
  PRE_APPROVAL?: string[];
  COLLABORATIVE_FEEDBACK?: string[];
  SPATIAL_CONSIDERATION?: string[];
}

/**
 * KV Space data structure - new format from KV storage
 */
export interface KVSpaceData {
  memory_narrative: string;
  characteristics: Record<string, string[]>;
  temporal_pattern: Record<string, string[]>;
  outcome_affordance: Record<string, string[]>;
  governance_mode: Record<string, string[]>;
  norm: Record<string, string[]>;
  space_id: string;
  name: string;
  space_type: string;
  owner_entity: string;
  access_type: string;
  min_capacity: number | null;
  max_capacity: number | null;
  area_size: number;
  sensors: {
    noise: boolean;
    cctv: boolean;
  };
  opening_hours: {
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
    holidays: string;
    notes: string | null;
  };
  booking_policy: {
    cancellation: boolean;
    modification: boolean;
    reservation_required: boolean;
    deposit_required: boolean;
  };
  min_mins_per_use: number | null;
  max_mins_per_use: number | null;
  fee_policy: string;
  status: string;
  last_updated: string;
  address: string;
  coordinate: {
    lat: number;
    lng: number;
  };
  amenities: string[];
  accessibility: string[];
}

export interface SpaceInfo {
  id: number;
  name: string;
  space_type: string;
  address: string;
  coordinate: SpaceCoordinate;
  access_type: string;
  capacity: number;
  area_size: number;
  amenities: string[];
  accessibility: string[];
  sensors: SpaceSensors;
  access_frequency: string;
  status: string;
  opening_hours: SpaceOpeningHours;
  fee_policy: string;
  booking_policy: SpaceBookingPolicy;
  max_mins_per_use: number;
  min_mins_per_use: number;
  characteristics: SpaceCharacteristics | null;
  temporal_pattern: SpaceTemporalPattern | null;
  outcome_affordance: SpaceOutcomeAffordance | null;
  governance_mode: SpaceGovernanceMode | null;
  norms: SpaceNorms | null;
  rating: number;
}

export interface SearchContext {
  filters_used: {
    address?: string;
    capacity?: number;
    time_preference?: string;
    characteristics?: any;
    temporal_patterns?: any;
    outcome_affordances?: any;
    governance_modes?: any;
    norms?: any;
    amenities?: any;
    accessibility?: any;
  };
  result_count: number;
  search_mode: string;
  excluded_spaces: number[];
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  intent_type?: IntentType;
  timestamp: number;
  metadata?: {
    search_results?: SpaceInfo[];
    registration_step?: number;
  };
}

export interface ChatSession {
  session_id: string;
  messages: SessionMessage[];
  last_updated: number;
  created_at: number;
}

/**
 * SEARCH_SPACE specific success response with data field
 */
export interface SearchSpaceSuccessResponse {
  status: "SUCCESS";
  intent_type: "SEARCH_SPACE";
  data: SpaceInfo[];
  total_count: number;
  search_context?: SearchContext;
  llm_response: string;
}

/**
 * Updated success response union type
 */
export type IntentAnalysisSuccessResponseUpdated = 
  | SearchSpaceSuccessResponse 
  | { status: "SUCCESS"; intent_type: "ADD_SPACE" | "CREATE_USER_PROFILE"; llm_response: string };

/**
 * Updated response union type
 */
export type IntentAnalysisResponseUpdated = IntentAnalysisSuccessResponseUpdated | IntentAnalysisFailureResponse;
