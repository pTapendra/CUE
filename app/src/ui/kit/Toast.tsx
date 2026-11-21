import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, space, type, useTokens } from '../tokens';

type ToastAction = { label: string; onPress: () => void };
type Toast = { message: string; action?: ToastAction };
type Api = { show: (message: string, action?: ToastAction) => void };

const DURATION_MS = 4000;
const ToastContext = createContext<Api>({ show: () => {} });

export function useToast(): Api {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTokens();
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const hide = useCallback(() => {
    clear();
    setToast(null);
  }, [clear]);
  const show = useCallback(
    (message: string, action?: ToastAction) => {
      clear();
      setToast({ message, action });
      timer.current = setTimeout(() => setToast(null), DURATION_MS);
    },
    [clear],
  );
  useEffect(() => clear, [clear]);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={styles.wrap}>
          <View accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: colors.text }]}>
            <Text style={[type.body, styles.message, { color: colors.bg }]}>{toast.message}</Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={toast.action.label}
                onPress={() => {
                  const run = toast.action?.onPress;
                  hide();
                  run?.();
                }}
                style={styles.action}
              >
                <Text style={[type.bodyStrong, { color: colors.bg }]}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, bottom: 96 },
  toast: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, paddingLeft: space.lg },
  message: { flex: 1, paddingVertical: space.md },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg },
});
