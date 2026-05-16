import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Note } from '../../src/domain/note';
import { deleteNote, getNote } from '../../src/storage/notesStorage';

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [note, setNote] = useState<Note | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const createdAt = useMemo(() => {
    if (!note) {
      return '';
    }

    return formatCreatedAt(note.createdAt);
  }, [note]);

  useEffect(() => {
    let isActive = true;

    async function loadNote() {
      if (!id) {
        setIsLoading(false);
        return;
      }

      const storedNote = await getNote(id);

      if (isActive) {
        setNote(storedNote);
        setIsLoading(false);
      }
    }

    loadNote();

    return () => {
      isActive = false;
    };
  }, [id]);

  async function handleDelete() {
    if (!note) {
      return;
    }

    await deleteNote(note.id);
    router.replace('/');
  }

  function confirmDelete() {
    Alert.alert('Delete note?', 'This note will be removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: handleDelete },
    ]);
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!note) {
    return (
      <View style={styles.center}>
        <Text style={styles.missingTitle}>Note not found</Text>
        <Pressable onPress={() => router.replace('/')} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Back to notes</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{note.title}</Text>
      <Text style={styles.createdAt}>{createdAt}</Text>
      <Text style={styles.body}>{note.body || 'No body text.'}</Text>

      <Pressable
        onPress={confirmDelete}
        style={({ pressed }) => [styles.deleteButton, pressed ? styles.deletePressed : null]}
      >
        <Text style={styles.deleteButtonText}>Delete Note</Text>
      </Pressable>
    </View>
  );
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    color: '#25231f',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 8,
  },
  createdAt: {
    color: '#776f63',
    fontSize: 14,
    marginBottom: 22,
  },
  body: {
    color: '#403c35',
    flex: 1,
    fontSize: 17,
    lineHeight: 25,
  },
  deleteButton: {
    alignItems: 'center',
    borderColor: '#b03a2e',
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 13,
  },
  deletePressed: {
    backgroundColor: '#f4e7e4',
  },
  deleteButtonText: {
    color: '#b03a2e',
    fontSize: 16,
    fontWeight: '800',
  },
  missingTitle: {
    color: '#25231f',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  secondaryButton: {
    backgroundColor: '#2f6f73',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
