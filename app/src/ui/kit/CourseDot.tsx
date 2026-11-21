import React from 'react';
import { View } from 'react-native';
import type { CourseColor } from '../tokens';

export function CourseDot({ color, size = 10 }: { color: CourseColor; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color.mark }}
    />
  );
}
