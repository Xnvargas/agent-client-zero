/**
 * Form Renderer Component
 *
 * Renders dynamic forms from agent form request metadata.
 * Supports text, date, file, select, checkbox, and multi-select fields.
 */

'use client'

import React, { useState, useCallback } from 'react'
import type { FormRendererProps } from './types'
import type { FormField } from '@/lib/a2a'

/**
 * Individual form field component
 */
interface FormFieldRendererProps {
  field: FormField
  value: unknown
  onChange: (fieldId: string, value: unknown) => void
}

const FormFieldRenderer: React.FC<FormFieldRendererProps> = ({ field, value, onChange }) => {
  const handleChange = useCallback(
    (newValue: unknown) => {
      onChange(field.id, newValue)
    },
    [field.id, onChange]
  )

  const baseInputClasses =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none'

  switch (field.type) {
    case 'text':
      return (
        <input
          type="text"
          id={field.id}
          value={(value as string) || ''}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={field.description}
          required={field.required}
          className={baseInputClasses}
        />
      )

    case 'date':
      return (
        <input
          type="date"
          id={field.id}
          value={(value as string) || ''}
          onChange={(e) => handleChange(e.target.value)}
          required={field.required}
          className={baseInputClasses}
        />
      )

    case 'file':
      return (
        <input
          type="file"
          id={field.id}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              // Convert file to base64 for transmission
              const reader = new FileReader()
              reader.onload = () => {
                handleChange({
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  data: reader.result,
                })
              }
              reader.readAsDataURL(file)
            }
          }}
          required={field.required}
          className={baseInputClasses}
        />
      )

    case 'single_select':
      return (
        <select
          id={field.id}
          value={(value as string) || ''}
          onChange={(e) => handleChange(e.target.value)}
          required={field.required}
          className={baseInputClasses}
        >
          <option value="">Select...</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )

    case 'multi_select':
      return (
        <select
          id={field.id}
          multiple
          value={(value as string[]) || []}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions, (option) => option.value)
            handleChange(selected)
          }}
          required={field.required}
          className={`${baseInputClasses} min-h-[100px]`}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )

    case 'checkbox':
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            id={field.id}
            checked={Boolean(value)}
            onChange={(e) => handleChange(e.target.checked)}
            required={field.required}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">{field.description}</span>
        </label>
      )

    case 'checkbox_group':
      return (
        <div className="space-y-2">
          {field.options?.map((option) => {
            const selectedValues = (value as string[]) || []
            const isChecked = selectedValues.includes(option.value)
            return (
              <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    const newValues = e.target.checked
                      ? [...selectedValues, option.value]
                      : selectedValues.filter((v) => v !== option.value)
                    handleChange(newValues)
                  }}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{option.label}</span>
              </label>
            )
          })}
        </div>
      )

    default:
      return (
        <input
          type="text"
          id={field.id}
          value={(value as string) || ''}
          onChange={(e) => handleChange(e.target.value)}
          className={baseInputClasses}
        />
      )
  }
}

/**
 * Main Form Renderer Component
 */
export const FormRenderer: React.FC<FormRendererProps> = ({ form, onSubmit, onCancel, className = '' }) => {
  // Initialize form values with defaults
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    form.fields.forEach((field) => {
      if (field.default_value !== undefined) {
        initial[field.id] = field.default_value
      }
    })
    return initial
  })

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleFieldChange = useCallback((fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setIsSubmitting(true)
      try {
        await onSubmit(values)
      } finally {
        setIsSubmitting(false)
      }
    },
    [values, onSubmit]
  )

  // Calculate grid columns
  const gridCols = form.columns || 1

  return (
    <div className={`border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-6 ${className}`}>
      {/* Form Header */}
      {(form.title || form.description) && (
        <div className="mb-6">
          {form.title && (
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{form.title}</h3>
          )}
          {form.description && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{form.description}</p>
          )}
        </div>
      )}

      {/* Form Fields */}
      <form onSubmit={handleSubmit}>
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          }}
        >
          {form.fields.map((field) => (
            <div
              key={field.id}
              style={{
                gridColumn: field.col_span ? `span ${field.col_span}` : undefined,
              }}
            >
              {field.type !== 'checkbox' && (
                <label
                  htmlFor={field.id}
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
              )}
              <FormFieldRenderer field={field} value={values[field.id]} onChange={handleFieldChange} />
              {field.description && field.type !== 'checkbox' && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{field.description}</p>
              )}
            </div>
          ))}
        </div>

        {/* Form Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : form.submit_label || 'Submit'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default FormRenderer
