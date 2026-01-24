/**
 * Layout Toggle Component
 *
 * Provides UI controls for switching between chat layout modes.
 * Can be rendered as a floating button or integrated into a menu.
 */

'use client'

import React, { useCallback } from 'react'
import type { ChatLayout } from './types/chat'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface LayoutToggleProps {
  currentLayout: ChatLayout
  onLayoutChange: (layout: ChatLayout) => void
  variant?: 'floating' | 'inline' | 'menu'
  className?: string
}

interface LayoutOption {
  value: ChatLayout
  label: string
  icon: string
  description: string
}

// =============================================================================
// LAYOUT OPTIONS
// =============================================================================

const LAYOUT_OPTIONS: LayoutOption[] = [
  {
    value: 'fullscreen',
    label: 'Fullscreen',
    icon: '\u2B1C', // White square
    description: 'Chat fills the entire screen'
  },
  {
    value: 'sidebar',
    label: 'Sidebar',
    icon: '\u2590', // Right half block
    description: 'Chat appears as a side panel'
  },
  {
    value: 'float',
    label: 'Float',
    icon: '\uD83D\uDCAC', // Speech bubble
    description: 'Chat widget with launcher bubble'
  }
]

// =============================================================================
// COMPONENT
// =============================================================================

export default function LayoutToggle({
  currentLayout,
  onLayoutChange,
  variant = 'floating',
  className = ''
}: LayoutToggleProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  const handleSelect = useCallback((layout: ChatLayout) => {
    onLayoutChange(layout)
    setIsOpen(false)
  }, [onLayoutChange])

  const currentOption = LAYOUT_OPTIONS.find(opt => opt.value === currentLayout)

  // Floating variant - renders as a FAB with dropdown
  if (variant === 'floating') {
    return (
      <div className={`layout-toggle layout-toggle--floating ${className}`}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="layout-toggle__trigger"
          aria-label="Change layout"
          title={`Current: ${currentOption?.label}`}
        >
          {currentOption?.icon || '\u2699\uFE0F'}
        </button>

        {isOpen && (
          <>
            {/* Backdrop to close on outside click */}
            <div
              className="layout-toggle__backdrop"
              onClick={() => setIsOpen(false)}
            />

            <div className="layout-toggle__menu">
              {LAYOUT_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`layout-toggle__option ${
                    option.value === currentLayout ? 'layout-toggle__option--active' : ''
                  }`}
                >
                  <span className="layout-toggle__option-icon">{option.icon}</span>
                  <span className="layout-toggle__option-content">
                    <span className="layout-toggle__option-label">{option.label}</span>
                    <span className="layout-toggle__option-desc">{option.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  // Inline variant - renders as button group
  if (variant === 'inline') {
    return (
      <div className={`layout-toggle layout-toggle--inline ${className}`}>
        {LAYOUT_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
            className={`layout-toggle__inline-btn ${
              option.value === currentLayout ? 'layout-toggle__inline-btn--active' : ''
            }`}
            title={option.description}
          >
            <span>{option.icon}</span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    )
  }

  // Menu variant - returns options for integration into existing menus
  return (
    <div className={`layout-toggle layout-toggle--menu ${className}`}>
      <div className="layout-toggle__menu-label">Layout</div>
      {LAYOUT_OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => handleSelect(option.value)}
          className={`layout-toggle__menu-item ${
            option.value === currentLayout ? 'layout-toggle__menu-item--active' : ''
          }`}
        >
          <span>{option.icon}</span>
          <span>{option.label}</span>
          {option.value === currentLayout && <span>{'\u2713'}</span>}
        </button>
      ))}
    </div>
  )
}

// =============================================================================
// HOOK FOR MENU INTEGRATION
// =============================================================================

/**
 * Hook to generate menu options for Carbon AI Chat header menu
 * Use this to integrate layout switching into the existing header menu
 */
export function useLayoutMenuOptions(
  currentLayout: ChatLayout,
  onLayoutChange: (layout: ChatLayout) => void
) {
  return LAYOUT_OPTIONS.map(option => ({
    text: `${option.icon} ${option.label}${option.value === currentLayout ? ' \u2713' : ''}`,
    handler: () => onLayoutChange(option.value)
  }))
}
