import React, { createContext, useState, useCallback } from 'react';

export const PrivacyModeContext = createContext({
  showAmounts: true,
  togglePrivacy: () => {},
});

export function PrivacyModeProvider({ children }) {
  const [showAmounts, setShowAmounts] = useState(true);
  const togglePrivacy = useCallback(() => setShowAmounts(prev => !prev), []);
  return (
    <PrivacyModeContext.Provider value={{ showAmounts, togglePrivacy }}>
      {children}
    </PrivacyModeContext.Provider>
  );
}
