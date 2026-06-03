// 智能输入框组件：支持公式计算（以 = 开头）与日期输入的通用输入框，聚焦时展示表达式，失焦后展示计算结果
import React, { useState, useEffect } from 'react';
import { evaluateExpression } from '../../utils/helpers';
import { AppleDatePicker } from './AppleDatePicker';

export const SmartInput = ({ value, onChange, placeholder, className, isDate = false, type = "text", disabled = false }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');

  useEffect(() => { if (!isEditing) setLocalValue(value || ''); }, [value, isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    onChange(localValue, isDate ? localValue : evaluateExpression(localValue));
  };

  // 日期模式：使用 AppleDatePicker 替代浏览器原生的 type="date"
  if (isDate) {
    return (
      <AppleDatePicker
        value={localValue || value}
        onChange={(iso) => {
          setLocalValue(iso);
          onChange(iso, iso);
        }}
        placeholder={placeholder || '选择日期'}
        className={className}
        disabled={disabled}
      />
    );
  }

  return (
    <input
      type={type}
      value={isEditing ? localValue : (type === "number" ? localValue : evaluateExpression(localValue))}
      onChange={(e) => setLocalValue(e.target.value)}
      onFocus={() => setIsEditing(true)}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder}
      className={`px-3 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 focus:outline-none transition-all duration-300 dark:text-white ${className || ''} ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-900' : ''}`}
    />
  );
};
