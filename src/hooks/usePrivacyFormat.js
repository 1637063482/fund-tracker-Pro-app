import { useContext } from 'react';
import { PrivacyModeContext } from '../contexts/PrivacyModeContext';
import { formatMoney, formatPercent } from '../utils/helpers';

export function usePrivacyFormat() {
  const { showAmounts } = useContext(PrivacyModeContext);
  return {
    money: (val) => showAmounts ? formatMoney(val) : '****',
    percent: (val) => showAmounts ? formatPercent(val) : '**.**%',
    raw: (val, suffix = '') => showAmounts ? `${val}${suffix}` : `***${suffix}`,
  };
}
