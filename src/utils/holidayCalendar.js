export function isHolidayToday(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return true;

  try {
    const targetYear = date.getFullYear();
    const cacheKey = `HOLIDAY_CN_${targetYear}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const holidayData = JSON.parse(cached);
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const checkDateStr = `${targetYear}-${mm}-${dd}`;
      const holiday = holidayData.find(h => h.date === checkDateStr);
      if (holiday && holiday.isOffDay) return true;
    }
  } catch (e) {
    console.warn("节假日校验失败", e);
  }

  return false;
}
