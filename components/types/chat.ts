/**
 * Shared type definitions for multi-layout chat component
 */

// =============================================================================
// LAYOUT TYPES
// =============================================================================

/**
 * Available chat layout modes
 * - fullscreen: Chat fills entire viewport
 * - sidebar: Chat slides in from right side (380px width)
 * - float: Classic chat widget with launcher bubble
 */
export type ChatLayout = 'fullscreen' | 'sidebar' | 'float'

/**
 * Default layout when none is specified
 */
export const DEFAULT_LAYOUT: ChatLayout = 'fullscreen'

/**
 * localStorage key for persisting layout preference
 */
export const LAYOUT_STORAGE_KEY = 'agent-client-zero-layout'

// =============================================================================
// EXTENSION CONFIGURATION
// =============================================================================

/**
 * Extension configuration for A2A requests
 * Used to configure agent behavior (e.g., thinking mode)
 */
export interface A2AExtensionConfig {
  settings?: {
    thinking_group?: {
      thinking?: boolean
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

// =============================================================================
// CHAT PANEL PROPS
// =============================================================================

/**
 * Props for the unified ChatPanel component
 * Supports all three layout modes with the same interface
 */
export interface ChatPanelProps {
  // Required
  agentUrl: string

  // Agent configuration
  apiKey?: string
  agentName?: string
  agentDescription?: string
  agentIconUrl?: string

  // Layout configuration
  layout?: ChatLayout
  onLayoutChange?: (layout: ChatLayout) => void

  // Callbacks
  onDisconnect?: () => void

  // Feature flags
  extensions?: A2AExtensionConfig
  showThinkingIndicator?: boolean
  showLayoutToggle?: boolean
}

// =============================================================================
// VIEW STATE (Carbon AI Chat internal)
// =============================================================================

/**
 * Carbon AI Chat view state structure
 * Used for sidebar animation handling
 */
export interface CarbonViewState {
  mainWindow: boolean
  [key: string]: unknown
}

/**
 * Carbon AI Chat view change event
 */
export interface ViewChangeEvent {
  newViewState: CarbonViewState
  oldViewState?: CarbonViewState
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load saved layout preference from localStorage
 */
export function loadSavedLayout(): ChatLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT

  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (saved && ['fullscreen', 'sidebar', 'float'].includes(saved)) {
      return saved as ChatLayout
    }
  } catch {
    // Ignore localStorage errors
  }

  return DEFAULT_LAYOUT
}

/**
 * Save layout preference to localStorage
 */
export function saveLayoutPreference(layout: ChatLayout): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, layout)
  } catch {
    // Ignore localStorage errors
  }
}
