/**
 * Study Streak Tracker
 * Tracks consecutive daily study sessions using localStorage.
 */

const KEY_LAST_DATE = 'study_last_date';
const KEY_STREAK = 'study_streak';
const KEY_LONGEST = 'study_longest_streak';

function getToday() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Call on app load. Returns { streak, isNewDay, longestStreak }
 */
export function updateStreak() {
  try {
    const today = getToday();
    const yesterday = getYesterday();
    const lastDate = localStorage.getItem(KEY_LAST_DATE);
    let streak = parseInt(localStorage.getItem(KEY_STREAK) || '0', 10);
    let longest = parseInt(localStorage.getItem(KEY_LONGEST) || '0', 10);

    let isNewDay = false;

    if (lastDate === today) {
      // Already studied today — no change
    } else if (lastDate === yesterday) {
      // Consecutive day — increment
      streak += 1;
      isNewDay = true;
    } else {
      // Streak broken or first time
      streak = 1;
      isNewDay = true;
    }

    if (streak > longest) longest = streak;

    localStorage.setItem(KEY_LAST_DATE, today);
    localStorage.setItem(KEY_STREAK, String(streak));
    localStorage.setItem(KEY_LONGEST, String(longest));

    return { streak, isNewDay, longestStreak: longest };
  } catch {
    return { streak: 0, isNewDay: false, longestStreak: 0 };
  }
}

export function getStreak() {
  try {
    return {
      streak: parseInt(localStorage.getItem(KEY_STREAK) || '0', 10),
      longestStreak: parseInt(localStorage.getItem(KEY_LONGEST) || '0', 10),
    };
  } catch {
    return { streak: 0, longestStreak: 0 };
  }
}
