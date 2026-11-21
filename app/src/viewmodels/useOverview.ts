import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import type { Course, Overview } from '../api/types';

/**
 * Every upcoming item and study block (`getOverview`) and the course list, loaded each time the
 * screen comes into view. A failed load keeps what was loaded before, so the screen can still show it.
 */
export function useOverview() {
  const api = useApi();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may fill the screen.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const [o, c] = await Promise.all([api.getOverview(), api.listCourses()]);
      if (mine !== latest.current) return;
      setOverview(o);
      setCourses(c.courses);
    } catch (err) {
      if (mine === latest.current) setError(friendlyMessage(err));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { overview, courses, loading, error, reload };
}
