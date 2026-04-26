import React, { useState, useEffect } from 'react';
import { evaluateExpression } from '../../utils/helpers';

export const SmartInput = ({ value, onChange, placeholder, className, isDate = false, type = "text", disabled = false }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');

  useEffect(() => { if (!isEditing) setLocalValue(value || ''); }, [value, isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    onChange(localValue, isDate ? localValue : evaluateExpression(localValue));
  };

  return (
    <input
      type={isDate ? "date" : type}
      value={isEditing ? localValue : (isDate ? localValue : (type === "number" ? localValue : evaluateExpression(localValue)))}
      onChange={(e) => setLocalValue(e.target.value)}
      onFocus={() => setIsEditing(true)}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder}
      className={`px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all duration-300 dark:bg-slate-800 dark:border-slate-700 dark:text-white ${className} ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-900' : ''}`}
    />
  );
};