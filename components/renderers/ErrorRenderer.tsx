/**
 * Error Renderer Component
 *
 * Renders error messages from agent responses with
 * optional stack trace and context information.
 */

'use client'

import React, { useState } from 'react'
import type { ErrorRendererProps } from './types'

/**
 * Error Renderer Component
 */
export const ErrorRenderer: React.FC<ErrorRendererProps> = ({ error, className = '' }) => {
  const [showDetails, setShowDetails] = useState(false)
  const hasDetails = error.stacktrace || error.context

  return (
    <div className={`border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-lg p-4 ${className}`}>
      {/* Error Header */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 text-red-500 dark:text-red-400">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-red-800 dark:text-red-200">
              {error.code ? `Error: ${error.code}` : 'Error'}
            </h4>
            {hasDetails && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-red-600 dark:text-red-400 hover:underline"
              >
                {showDetails ? 'Hide details' : 'Show details'}
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error.message}</p>
        </div>
      </div>

      {/* Error Details (collapsible) */}
      {hasDetails && showDetails && (
        <div className="mt-4 pt-4 border-t border-red-200 dark:border-red-800">
          {/* Stack Trace */}
          {error.stacktrace && (
            <div className="mb-3">
              <h5 className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">Stack Trace</h5>
              <pre className="text-xs bg-red-100 dark:bg-red-900/40 p-3 rounded overflow-x-auto text-red-800 dark:text-red-200">
                {error.stacktrace}
              </pre>
            </div>
          )}

          {/* Context */}
          {error.context && (
            <div>
              <h5 className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">Context</h5>
              <pre className="text-xs bg-red-100 dark:bg-red-900/40 p-3 rounded overflow-x-auto text-red-800 dark:text-red-200">
                {JSON.stringify(error.context, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ErrorRenderer
