import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button } from '../ui/components';
import { useTheme } from '../ui/theme';

/** The ⚙ menu on the Week screen. */
export function SettingsMenu({
  visible,
  onStudyTimes,
  onCanvas,
  onClose,
}: {
  visible: boolean;
  onStudyTimes: () => void;
  onCanvas: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.background, borderColor: t.border }]}>
        <Button title="Study times" onPress={onStudyTimes} />
        <Button title="Canvas connection" variant="secondary" onPress={onCanvas} />
        <Button title="Cancel" variant="secondary" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { gap: 10, padding: 16, borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
});
