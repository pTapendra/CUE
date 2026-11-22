import React from 'react';
import { IconButton } from './IconButton';

/**
 * The person icon at the right end of every page's header; it opens Settings. The icon stays
 * generic: Cue never stores the student's name, initials or photo.
 */
export function ProfileButton({ onPress }: { onPress: () => void }) {
  return <IconButton icon="person-circle-outline" label="Settings" onPress={onPress} />;
}
